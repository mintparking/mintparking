/* =====================================================================
 * dashboard.js — หน้าแดชบอร์ด (index.html)
 * ต้องโหลดหลัง config.js และ parking.js
 * ===================================================================== */

const DEMO = new URLSearchParams(location.search).has("demo");   // ?demo = ข้อมูลจำลอง
let parking = {}, selected = null, online = false;

function statusOf(s) {
  if (s.known === 0)       return ["s-none", "ไม่มีข้อมูล"];
  if (s.free === 0)        return ["s-full", "เต็ม"];
  if (s.free <= LOW_LEFT)  return ["s-low", "ใกล้เต็ม"];
  return ["s-free", "ว่าง"];
}

// ---------- วาดหน้าจอ ----------
function render() {
  let sumFree = 0, sumTotal = 0;
  const box = $("floors");
  const now = refNow(FLOORS.map(f => parking[f.id]));
  box.innerHTML = "";

  for (const f of FLOORS) {
    const slots = slotsOf(f, parking[f.id], now);
    const s = summarize(slots);
    const [cls, label] = statusOf(s);
    sumFree += s.free; sumTotal += f.slots;

    const canPick = s.free > 0;
    if (selected === f.id && !canPick) { selected = null; toast(`${f.name} เต็มแล้ว กรุณาเลือกชั้นอื่น`); }

    const el = document.createElement("div");
    el.className = "floor" + (selected === f.id ? " selected" : "") + (canPick ? "" : " disabled");
    el.innerHTML = `
      <div class="row">
        <div class="fname">
          <div class="badge">${f.short || f.id}</div>
          <div><h2>${f.name}</h2><span class="status ${cls}">${label}</span></div>
        </div>
        <div class="count"><b>${s.free}</b><span> / ${f.slots}</span><small>ช่องว่าง</small></div>
      </div>
      <div class="slots">${slots.map((v, i) =>
        `<div class="slot ${v === 0 ? "free" : v === 1 ? "taken" : "unknown"}">${i + 1}</div>`).join("")}</div>
      ${s.known > 0 && s.known < f.slots ? '<div class="offline">⚠️ เซนเซอร์บางส่วนไม่มีข้อมูล</div>' : ""}`;
    el.onclick = () => {
      if (!canPick) return toast(s.known ? `${f.name} เต็มแล้ว` : `${f.name} ยังไม่มีข้อมูล`);
      selected = f.id; render();
    };
    box.appendChild(el);
  }

  const latest = latestTime(FLOORS.map(f => parking[f.id]));
  $("totalFree").textContent = sumFree;
  $("totalOf").textContent = `/ ${sumTotal} ช่อง`;
  $("totalBar").style.width = (sumTotal ? sumFree / sumTotal * 100 : 0) + "%";
  $("updated").textContent = latest ? "อัปเดตล่าสุด " + new Date(latest).toLocaleTimeString("th-TH") : "";

  const go = $("go"), sel = floorById(selected);
  go.disabled = !sel;
  go.textContent = sel ? `เริ่มนำทางไป ${sel.name}  →` : "เลือกชั้นที่ต้องการจอด";

  $("live").classList.toggle("off", !online);
  $("liveText").textContent = online ? (DEMO ? "โหมดสาธิต" : "ออนไลน์") : "ขาดการเชื่อมต่อ";
}

$("go").onclick = () => {
  if (selected) location.href = `${NAV_PAGE}?floor=${encodeURIComponent(selected)}`;
};

let toastTimer;
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}

// ---------- ดึงข้อมูล ----------
async function load() {
  if (DEMO) { demoTick(); online = true; render(); return; }
  try { parking = await fetchParking(); online = true; }
  catch (e) { online = false; }
  render();
}

// ข้อมูลจำลอง ใช้ดูหน้าตาโดยไม่ต้องมีเซนเซอร์ (เปิดด้วย ?demo)
function demoTick() {
  for (const f of FLOORS) {
    const d = parking[f.id] || (parking[f.id] = {
      slots: Array.from({ length: f.slots }, () => +(Math.random() < 0.6)), units: {} });
    if (f.id === "F3") d.slots = d.slots.map(() => 1);                          // ชั้น 5A เต็ม
    else if (Math.random() < 0.5) { const i = Math.floor(Math.random() * f.slots); d.slots[i] ^= 1; }
    d.units = { A: { t: Date.now(), from: 0, count: 5 },
                B: { t: f.id === "F5" ? 0 : Date.now(), from: 5, count: 5 } };     // ชั้น 6A ตัว B ออฟไลน์
  }
}

render();
load();
setInterval(load, POLL_MS);
