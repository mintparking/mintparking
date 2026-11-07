/* =====================================================================
 * nav.js — หน้านำทาง (nav.html)
 * ต้องโหลดหลัง config.js และ parking.js
 * ค่าเส้นทาง ข้อความ และเกณฑ์สัญญาณ อยู่ใน config.js
 * ===================================================================== */

const q = new URLSearchParams(location.search);
const DEBUG = q.has("debug");          // ?debug = แสดงค่าสัญญาณ Beacon
const SIM   = q.has("sim");            // ?sim   = ปุ่มจำลอง Beacon ทดสอบได้โดยไม่ต้องมี Beacon จริง
const floorId = q.get("floor");
const floor = floorById(floorId);
const chain = BUILDING[floorId];
const supported = !!(navigator.bluetooth && navigator.bluetooth.requestLEScan);
if (!floor || !chain) location.replace(DASHBOARD_PAGE);   // ไม่ได้เลือกชั้นมา -> กลับแดชบอร์ด

// ---------- รวมทุกจุดเป็นโหนดเดียวกัน ----------
// โหนดภายนอก = "A1".."E1", โหนดในอาคาร = "IN0".."INn" (ลำดับใน BUILDING ของชั้นนั้น)
function stepOf(node) {
  if (node.startsWith("IN")) { const s = chain[+node.slice(2)]; return { ...s, beacon: s.b }; }
  return { ...OUTDOOR[node], beacon: node };
}
const IN_NODES = chain ? chain.map((_, i) => "IN" + i) : [];
const OUT_ALL  = [...ROUTE_A, ...ROUTE_B];

// จุดที่อนุญาตให้แทร็กได้ถัดจาก node (null = ยังไม่เจอจุดไหน)
function allowedAfter(node) {
  if (node === null) return [...OUT_ALL, ...IN_NODES];
  if (node.startsWith("IN")) return IN_NODES.slice(+node.slice(2) + 1);
  if (BRANCH[node] && !ROUTE_A.includes(node) && !ROUTE_B.includes(node)) return BRANCH[node];   // C1, C2, E1
  const route = ROUTE_A.includes(node) ? ROUTE_A : ROUTE_B;
  return [...route.slice(route.indexOf(node) + 1), ...(BRANCH[node] || []), ...IN_NODES];
}

const beacons = {}, seen = {};
let current = null;      // จุดล่าสุดที่แทร็กแล้ว
let near = false;        // ยังอยู่ใกล้ current หรือไม่
let finished = false;    // ถึงจุดสุดท้ายแล้ว
let arrivedView = false;
let trail = [];
let started = false, floorData = {}, wakeLock = null;

// ---------- ลูกศร ----------
const ARROWS = {
  straight:  '<path d="M60 102V30M34 54l26-26 26 26"/>',
  up:        '<path d="M60 102V30M34 54l26-26 26 26"/><path d="M30 104h60" stroke-dasharray="6 8"/>',
  right:     '<path d="M38 104V62a12 12 0 0 1 12-12h44M74 28l22 22-22 22"/>',
  left:      '<path d="M82 104V62a12 12 0 0 0-12-12H26M46 28L24 50l22 22"/>',
  rightleft: '<path d="M36 106V82h44V42H34M52 24L34 42l18 18"/>',
  park:      '<rect x="22" y="18" width="76" height="84" rx="16"/><path d="M48 86V36h16a14 14 0 0 1 0 28H48"/>',
};
const arrowSvg = k => `<svg viewBox="0 0 120 120" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round" stroke-linejoin="round">${ARROWS[k] || ARROWS.straight}</svg>`;

// ---------- ช่องจอดของชั้นปลายทาง ----------
const slotsNow = () => slotsOf(floor, floorData, refNow([floorData]));

async function loadFloor() {
  try { floorData = await fetchParking(floorId); } catch (e) {}
  renderFloor();
}

let wasFull = false;
function renderFloor() {
  const slots = slotsNow(), s = summarize(slots);
  const b = $("freeBadge");
  b.className = "free " + (!s.known ? "none" : s.free === 0 ? "full" : s.free <= LOW_LEFT ? "low" : "");
  b.textContent = !s.known ? "ไม่มีข้อมูล" : s.free === 0 ? "เต็ม" : `ว่าง ${s.free}/${s.total}`;

  $("fullText").textContent = `⚠️ ${floor.name} เต็มแล้ว`;
  $("fullAlert").classList.toggle("show", s.full && !finished);
  if (s.full && !wasFull && started && !finished) speak(`${floor.name} เต็มแล้ว กรุณาเปลี่ยนชั้น`);
  wasFull = s.full;

  $("slots").innerHTML = slots.map((v, i) =>
    `<div class="slot ${v === 0 ? "f" : v === 1 ? "t" : "u"}">${i + 1}</div>`).join("");
  if (arrivedView) {
    const list = slots.map((v, i) => v === 0 ? i + 1 : null).filter(Boolean);
    $("detail").textContent = !s.known ? "ยังไม่มีข้อมูลช่องจอดของชั้นนี้"
      : list.length ? `ช่องว่าง: ${list.join(", ")}` : "ขณะนี้ไม่มีช่องว่าง";
  }
}

// ---------- แสดงผล ----------
function setMsg(t) { $("msg").textContent = t; $("msg").classList.toggle("long", t.length > 12); }

function render() {
  const st = current ? stepOf(current) : null;
  const showStep = st && (near || finished);
  document.body.classList.toggle("turn", !!showStep && !arrivedView);
  document.body.classList.toggle("arrived", arrivedView);

  if (arrivedView) {
    $("arrow").innerHTML = arrowSvg("park");
    setMsg(floor.name);
    renderFloor();
  } else if (showStep) {
    $("arrow").innerHTML = arrowSvg(st.arrow);
    setMsg(st.msg);
    $("detail").textContent = st.sub || "";
  } else {
    $("arrow").innerHTML = arrowSvg("straight");
    setMsg("ขับตรงไปตามทาง");
    $("detail").textContent = "ระบบจะแจ้งเมื่อถึงจุดถัดไป";
  }
  $("code").textContent = st ? `จุด ${st.beacon}` : "";
  $("code").classList.toggle("on", !!showStep);
  $("prev").textContent = (st && !near && !finished) ? `ล่าสุด (${st.beacon}): ${st.say}` : "";
  const names = trail.map(n => stepOf(n).beacon);
  $("progress").innerHTML = names.length
    ? names.map((n, i) => `<b class="${i === names.length - 1 && (near || finished) ? "now" : ""}">${n}</b>`).join("<span>›</span>")
    : "ยังไม่ผ่านจุดใด";
}

function speak(t) {
  try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(t); u.lang = "th-TH"; speechSynthesis.speak(u); } catch (e) {}
}

// ---------- ตรรกะนำทาง ----------
function rssi(name) { const b = beacons[name]; return b ? b.avg : -100; }

function update() {
  const now = Date.now();
  for (const b of Object.values(beacons)) if (now - b.lastSeen > LOST_MS) b.avg = -100;

  if (!finished) {
    if (near && rssi(stepOf(current).beacon) < RSSI_FAR) { near = false; render(); }

    // หาจุดถัดไปที่อนุญาตและสัญญาณแรงที่สุด
    let best = null, bestR = -999;
    for (const node of allowedAfter(current)) {
      const name = stepOf(node).beacon, r = rssi(name);
      if (r > (NEAR_OVERRIDE[name] ?? RSSI_NEAR) && r > bestR) { best = node; bestR = r; }
    }
    if (best && (!near || bestR > rssi(stepOf(current).beacon))) {
      current = best; near = true; trail.push(best);
      const st = stepOf(best);
      speak(st.say);
      if (navigator.vibrate) navigator.vibrate([300, 100, 300]);
      if (st.final) {
        finished = true;
        $("fullAlert").classList.remove("show");
        // "ถึงชั้นจอดรถของคุณแล้ว" -> หน้าถึงชั้นเกือบทันที, "ขึ้นไปยังชั้น ..." -> ค้างข้อความไว้ก่อน
        setTimeout(() => { arrivedView = true; render(); }, st.arrow === "park" ? 2500 : ARRIVE_MS);
      }
      render();
    }
  }

  if (DEBUG) {
    const list = Object.values(seen).filter(d => now - d.t < 5000).sort((a, b) => b.rssi - a.rssi).slice(0, 6)
      .map(d => `${d.rssi} dBm | ${d.name}` + (beacons[d.name] ? ` (เฉลี่ย ${Math.round(beacons[d.name].avg)})` : ""));
    const next = finished ? "-" : [...new Set(allowedAfter(current).map(n => stepOf(n).beacon))].join(", ");
    $("debug").textContent = `ล่าสุด: ${current ? stepOf(current).beacon : "-"} · รอ: ${next}\n` + (list.join("\n") || "ยังไม่เจอ Beacon");
  }
}

// ---------- รับสัญญาณ Beacon ----------
const NAMES = new Set([...Object.keys(OUTDOOR), ...(chain || []).map(s => s.b)]);
function onAdv(ev) {
  const raw = ev.device.name || ev.name;
  const name = raw ? raw.trim().toUpperCase() : "";
  if (DEBUG) seen[ev.device.id] = { name: raw || "(ไม่มีชื่อ)", rssi: ev.rssi, t: Date.now() };
  if (!NAMES.has(name) || ev.rssi == null) return;
  feed(name, ev.rssi);
}
function feed(name, r) {
  const b = beacons[name] || (beacons[name] = { avg: r, lastSeen: 0 });
  b.avg = 0.7 * b.avg + 0.3 * r;          // กรองค่าให้นิ่ง
  b.lastSeen = Date.now();
  if (DEBUG && SIM) seen["sim-" + name] = { name, rssi: r, t: Date.now() };
}

// ---------- เริ่ม ----------
async function begin() {
  $("err").textContent = "";
  speak(`เริ่มนำทางไป${floor.name}`);
  if (!SIM) {
    if (!supported) { $("overlay").style.display = "flex"; return; }
    try {
      await navigator.bluetooth.requestLEScan({ acceptAllAdvertisements: true, keepRepeatedDevices: true });
    } catch (e) {
      $("err").textContent = "เริ่มสแกนไม่ได้: กรุณาเปิด Bluetooth และตำแหน่ง (Location) แล้วกดอนุญาต";
      return;
    }
    navigator.bluetooth.addEventListener("advertisementreceived", onAdv);
  }
  started = true;
  $("start").classList.add("hide");
  keepAwake(); render();
  setInterval(update, 300);
}
async function keepAwake() { try { if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen"); } catch (e) {} }
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && started) keepAwake(); });

// ---------- จำลอง Beacon (?sim) ----------
if (SIM && chain) {
  const box = $("sim"); box.classList.add("on");
  for (const name of NAMES) {
    const btn = document.createElement("button");
    btn.textContent = name;
    let timer = null;
    btn.onclick = () => {                       // แตะ = อยู่ใกล้ Beacon นี้ 4 วินาที แล้วห่างออกไป
      btn.classList.add("hold"); clearInterval(timer);
      let t = 0;
      timer = setInterval(() => {
        t += 300;
        if (t < 4000) feed(name, -55);
        else if (t < 7000) feed(name, -95);
        else { clearInterval(timer); btn.classList.remove("hold"); }
      }, 300);
    };
    box.appendChild(btn);
  }
}

// ---------- ปุ่ม และกล่องแจ้งเตือน flag ----------
const goBack = () => location.href = DASHBOARD_PAGE;
$("back").onclick = goBack; $("back2").onclick = goBack; $("change").onclick = goBack;
$("go").onclick = begin;

async function copyFlag() {
  try { await navigator.clipboard.writeText(FLAG_URL); }
  catch (e) { const t = document.createElement("textarea"); t.value = FLAG_URL; document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove(); }
}
$("allow").onclick = async () => { await copyFlag(); $("ask").style.display = "none"; $("steps2").style.display = "block"; };
$("copyAgain").onclick = async () => { await copyFlag(); $("copied").textContent = "✅ คัดลอกให้อีกครั้งแล้ว"; };
$("deny").onclick = goBack;

if (floor && chain) {
  $("destName").textContent = floor.name;
  $("startTitle").textContent = `นำทางไป${floor.name}`;
  if (!supported && !SIM) $("overlay").style.display = "flex";
  render(); loadFloor(); setInterval(loadFloor, POLL_MS);
}
