/* =====================================================================
 * parking.js — โค้ดที่ใช้ร่วมกันทั้งสองหน้า (ดึงข้อมูลและคำนวณช่องว่าง)
 * ต้องโหลดหลัง config.js
 * ===================================================================== */

const $ = id => document.getElementById(id);
const floorById = id => FLOORS.find(f => f.id === id);

// ดึงข้อมูลจาก Firebase เช่น fetchParking() = ทุกชั้น, fetchParking("F1") = ชั้นเดียว
async function fetchParking(floorId) {
  const path = floorId ? `/parking/${floorId}.json` : "/parking.json";
  const r = await fetch(FIREBASE_URL + path, { cache: "no-store" });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return (await r.json()) || {};
}

// เวลาอ้างอิง: ไม่ใช้นาฬิกามือถือตรง ๆ เพราะถ้านาฬิกามือถือเพี้ยน ESP32 ทุกตัวจะดูเหมือนออฟไลน์
// ใช้เวลาของ ESP32 ตัวที่ส่งข้อมูลล่าสุด (เวลาจากเซิร์ฟเวอร์ Firebase) เป็นตัวเทียบแทน
function latestTime(floorDataList) {
  let newest = 0;
  for (const d of floorDataList)
    for (const u of Object.values((d || {}).units || {})) newest = Math.max(newest, u.t || 0);
  return newest;
}
function refNow(floorDataList) {
  const newest = latestTime(floorDataList);
  return newest && Date.now() - newest < ALL_DOWN_MS ? newest : Date.now();
}

// สถานะช่องจอดของหนึ่งชั้น: 0 = ว่าง, 1 = มีรถ, null = ไม่ทราบ (ESP32 ออฟไลน์ หรือเซนเซอร์เสีย)
function slotsOf(floor, data, now) {
  const d = data || {};
  const arr = new Array(floor.slots).fill(null);
  for (const [k, v] of Object.entries(d.slots || {}))
    if (+k < floor.slots) arr[+k] = (v === 0 || v === 1) ? v : null;   // 2 = เซนเซอร์เสีย
  for (const u of Object.values(d.units || {}))
    if (!u.t || now - u.t > STALE_MS)
      for (let i = u.from; i < u.from + u.count && i < floor.slots; i++) arr[i] = null;
  return arr;
}

// สรุปตัวเลขของชั้น
function summarize(slots) {
  const free = slots.filter(s => s === 0).length;
  const known = slots.filter(s => s !== null).length;
  return { free, known, total: slots.length, full: known > 0 && free === 0 };
}
