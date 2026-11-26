export function InstallGuide() {
  return (
    <section className="rounded-xl border border-border p-3 text-sm" aria-labelledby="ig">
      <h2 id="ig" className="font-semibold">เพิ่มไว้หน้าจอหลักก่อนนะ</h2>
      <p>บน iPhone ต้องเพิ่มแอปไว้หน้าจอหลักก่อน ถึงจะรับการแจ้งเตือนได้</p>
      <ol className="ml-5 list-decimal">
        <li>แตะปุ่มแชร์ (สี่เหลี่ยมมีลูกศรชี้ขึ้น) ที่ Safari</li>
        <li>เลื่อนลงแล้วเลือก "เพิ่มลงในหน้าจอโฮม"</li>
        <li>เปิดแอปจากไอคอนบนหน้าจอหลัก แล้วกลับมาเปิดการแจ้งเตือนที่นี่</li>
      </ol>
    </section>
  )
}
