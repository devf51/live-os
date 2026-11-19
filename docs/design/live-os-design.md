# live os — Design

อ้างอิง spec: `docs/specs/live-os-spec.md`

**ข้อจำกัดที่ผู้ใช้ตัดสินแล้ว:** เว็บแอปติดตั้งเป็น PWA เน้นมือถือ (Android และ iOS), เตือนผ่าน Web Push, รันบน VPS ส่วนตัวของผู้ใช้, โมเดล AI คือ Claude Haiku 5.5 ผ่าน Anthropic API (เติมเงินแยก), ใช้คนเดียว, **ขั้นต่อแชทกับโมเดลจริงทำท้ายสุด**

**สมมติฐาน (ผู้ใช้แก้ได้):** VPS เป็น Linux ที่ติดตั้ง Node และ MySQL ได้ และมี HTTPS บนโดเมนของผู้ใช้ (Web Push บังคับ HTTPS) ราคา API ตรวจจริงก่อนเริ่มขั้นแชท ยังไม่ได้ตรวจ

## 1. ภาษาและเทคโนโลยี

| ส่วนของระบบ | ภาษา / เทคโนโลยี | เวอร์ชัน | เหตุผลที่เหมาะกับงาน |
|---|---|---|---|
| ทุกส่วน | TypeScript | 7.0.2 | ภาษาหลักของผู้ใช้ ใช้ชนิดข้อมูลร่วมกันระหว่างหน้าเว็บและเซิร์ฟเวอร์ |
| รันไทม์เซิร์ฟเวอร์ | Node.js | 24 (ตรวจจากเครื่องพัฒนา ตรวจบน VPS ตอนติดตั้ง) | รัน TypeScript ฝั่งเซิร์ฟเวอร์ ใช้ร่วมกับไลบรารีด้านล่าง |
| เซิร์ฟเวอร์ API | Fastify | 5.12.8 | เบา เร็ว มี schema validation ในตัว |
| ตรวจข้อมูลเข้า/ออก | zod | 4.6.7 | ใช้ชนิดเดียวกันทั้งหน้าเว็บ เซิร์ฟเวอร์ และผลลัพธ์จาก AI |
| ฐานข้อมูล | MySQL | 8.4 LTS (ผู้ใช้ยืนยันบน VPS ก่อนติดตั้ง ยังไม่ได้ตรวจ) | เทคโนโลยีหลักของผู้ใช้ ข้อมูลเป็นตารางสัมพันธ์ชัด |
| ตัวต่อ MySQL | mysql2 | 3.24.6 | ไดรเวอร์มาตรฐาน |
| ตัวสร้างคำสั่ง SQL | Kysely | 0.29.9 | ชนิดข้อมูลตรง ไม่ซ่อน SQL |
| เวลา/เขตเวลา | Luxon | 3.7.2 | จัดการ Asia/Bangkok และการซ้ำรายสัปดาห์ |
| ส่งการเตือน | web-push | 4.0.0 | ส่ง Web Push ไป Android และ iOS (PWA) |
| เรียกโมเดล AI | @anthropic-ai/sdk | 1.10.0 | SDK ทางการ ใช้ tool use ให้ AI ตอบเป็นโครงสร้าง |
| หน้าเว็บ | React | 19.3.1 | ผู้ใช้คุ้นเคยจาก LifeSeed |
| ตัวสร้างหน้าเว็บ | Vite | 8.3.8 | เบากว่า Next.js ไม่ต้องมี server rendering เพราะเป็นแอปส่วนตัว |
| PWA | vite-plugin-pwa | 2.0.0 | สร้าง manifest และ service worker ที่รับ Web Push |
| ทดสอบ | Vitest | 5.1.1 | ทดสอบทั้งเซิร์ฟเวอร์และหน้าเว็บ |
| ทดสอบหน้าเว็บ | Vitest + jsdom | ตามเวอร์ชัน Vitest | ไม่ต้องเพิ่มเครื่องมือทดสอบเบราว์เซอร์ในรอบแรก |
| จัดการโปรเจกต์ | npm workspaces | มากับ Node | โปรเจกต์เดียว สามแพ็กเกจ ไม่ต้องใช้เครื่องมือเพิ่ม |

**Anthropic SDK 1.10.0** ใช้เป็นหลักฐานเวอร์ชันล่าสุดที่ตรวจพบ ตรวจรุ่นโมเดล `claude-haiku-5-5` และราคาก่อนเริ่มขั้นแชท

## 2. โครงสร้างโปรเจค

```text
live-os/
├─ package.json                  # npm workspaces
├─ packages/
│  ├─ shared/                    # ชนิดข้อมูลและ zod schema ที่ใช้ร่วมกัน
│  │  └─ src/ (money.ts, schemas.ts, time.ts)
│  ├─ server/
│  │  ├─ src/
│  │  │  ├─ main.ts              # เริ่มเซิร์ฟเวอร์และตัวตั้งเวลา
│  │  │  ├─ auth/
│  │  │  ├─ db/ (client.ts, migrations/)
│  │  │  ├─ ledger/              # การเงิน
│  │  │  ├─ planner/             # งาน เหตุการณ์ ตารางเรียน นัด
│  │  │  ├─ habits/
│  │  │  ├─ reminders/           # สร้างการเตือน + ตัวตั้งเวลา
│  │  │  ├─ push/                # Web Push
│  │  │  ├─ llm/                 # LlmClient, AnthropicLlm, FakeLlm
│  │  │  ├─ chat/                # ตัวประสานบทสนทนา
│  │  │  └─ routes/
│  │  └─ test/
│  └─ web/
│     ├─ src/ (pages/, components/, sw.ts)
│     └─ test/
└─ docs/ (specs/, design/)
```

## 3. โค้ดเบส

| ส่วน / โมดูล | หน้าที่ |
|---|---|
| `shared/money` | เงินเป็นจำนวนเต็มสตางค์ แปลงเป็นข้อความบาท |
| `shared/time` | ฟังก์ชันเวลาเดียวทั้งระบบ เขตเวลา Asia/Bangkok แปลง พ.ศ. เป็น ค.ศ. ตอนรับค่า |
| `auth` | ผู้ใช้คนเดียว: รหัสผ่านเจ้าของ (เก็บแบบแฮชใน env) แล้วออกคุกกี้เซสชัน |
| `db` | เชื่อมต่อ MySQL และ migration |
| `ledger` | จดรายการ ยกเลิก งบต่อหมวด และสรุปรายเดือน |
| `planner` | งาน เหตุการณ์ (นัด ตารางเรียน) พร้อมซ้ำรายสัปดาห์ |
| `habits` | สร้างนิสัย บันทึกการทำ ตรวจความถี่ |
| `reminders` | สร้างรายการเตือนที่ถึงเวลา กันซ้ำ เคารพช่วงเวลาเงียบและเพดานต่อวัน |
| `push` | เก็บ subscription และส่ง Web Push ลองส่งซ้ำเมื่อพลาด |
| `llm` | interface `LlmClient` ช่องเดียว มี `FakeLlm` (เทสต์) และ `AnthropicLlm` (จริง) |
| `chat` | รับข้อความ ให้ `llm` แปลงเป็นคำสั่งมีโครงสร้าง ตรวจด้วย zod เรียกโมดูลข้างบน ตอบทวนหนึ่งบรรทัด |

**ขอบเขตสำคัญ:** `llm` ทำหน้าที่แปลภาษาไทยเป็นคำสั่งเท่านั้น ไม่เขียนฐานข้อมูลเอง `chat` ตรวจคำสั่งด้วย zod และกฎของโมดูล (เช่น วันที่ต้องเป็นอนาคตสำหรับนัด) ก่อนเขียนทุกครั้ง เมื่อ AI ไม่มั่นใจหรือวันที่กำกวม `chat` ถามผู้ใช้ก่อนจด ไม่เดา การเตือนไม่พึ่ง AI เลย `reminders` ทำงานจากข้อมูลในฐานข้อมูล ถึงแม้บริการ AI ล่มก็ยังเตือนได้

**ลำดับการสร้าง (ตามที่ผู้ใช้ขอให้แชทจริงไว้ท้ายสุด)**

1. รากฐาน: โปรเจกต์ ฐานข้อมูล auth หน้าเว็บ PWA เปล่า
2. โดเมน: `ledger`, `planner`, `habits` ทดสอบผ่านเทสต์และ API ไม่ต้องใช้ AI
3. การเตือน: `reminders` + `push` ใช้งานจริงบน Android และ iOS ก่อนมีแชท
4. หน้าจอดูข้อมูล: วันนี้ เงิน นิสัย ตั้งค่า
5. แชท: `llm`, `chat` เริ่มจาก `FakeLlm` แล้วต่อ Claude Haiku 5.5 จริง และวัดความแม่นยำภาษาไทย

## 4. UX/UI

### 4.1 UX

**เล่าแล้วจด** ผู้ใช้พิมพ์ "กินข้าว 80 บาท" → บอททวนหนึ่งบรรทัด "จดแล้ว: ข้าว 80 บาท (อาหาร) · แก้ · ยกเลิก" → ถ้าจดผิด กดแก้หรือยกเลิกได้ทันที

**ข้อความกำกวม** ผู้ใช้พิมพ์ "ศุกร์หน้าหมอฟัน" → บอทถามสั้นๆ "ศุกร์ที่ 27 พ.ย. เวลากี่โมงครับ" → ผู้ใช้ตอบ → จด

**เตือน** ถึงเวลา → การแจ้งเตือนบนมือถือ → กดเปิดแอปที่เรื่องนั้น

**งบเกิน** จดรายจ่ายแล้วใช้ถึง 80% หรือ 100% ของงบหมวด → บอทเตือนในแชท และส่งแจ้งเตือน หนึ่งครั้งต่อระดับต่อรอบเดือน

**ถามย้อน** "เดือนนี้ใช้ไปเท่าไหร่" → ระบบคำนวณจากฐานข้อมูล แล้วบอทตอบ (ตัวเลขมาจากฐานข้อมูล ไม่ให้ AI คำนวณเอง)

**ตั้งค่าครั้งแรก** เข้าสู่ระบบ → เปิดการแจ้งเตือน → บน iPhone ขึ้นคำแนะนำ "เพิ่มไว้หน้าจอหลักก่อน" พร้อมขั้นตอนภาพ → ทดสอบส่งการเตือนหนึ่งครั้ง

### 4.2 UI

| หน้าจอ | รายละเอียด |
|---|---|
| แชท (หน้าแรก) | ช่องพิมพ์ ประวัติข้อความ ข้อความจดแล้วมีปุ่ม แก้ / ยกเลิก สถานะ: กำลังคิด, ว่าง (ทักทายสั้น), error (ขออภัย ลองใหม่) |
| วันนี้ | เรียน นัด งานที่ถึงกำหนด นิสัยที่ต้องทำ แตะนิสัยเพื่อติ๊กทำแล้ว สถานะว่าง: "วันนี้ไม่มีอะไร" |
| เงิน | ยอดรอบเดือน งบต่อหมวดแบบแถบ รายการล่าสุด แตะรายการเพื่อแก้หรือลบ |
| นิสัย | รายการนิสัย ความถี่ สถิติต่อเนื่องแบบเรียบง่าย (ไม่มีต้นไม้ XP) |
| ตั้งค่า | เปิด/ปิดแจ้งเตือน เวลาล่วงหน้าเริ่มต้น (30 นาที) ช่วงเวลาเงียบ เพดานต่อวัน งบต่อหมวด ออกจากระบบ |
| เข้าสู่ระบบ | ช่องรหัสผ่านเจ้าของ ผิดซ้ำถูกหน่วง |
| ติดตั้ง/แนะนำ iOS | แสดงเมื่อเปิดบน iPhone ที่ยังไม่ได้เพิ่มไว้หน้าจอหลัก |

**หลักการหน้าตา:** เน้นมือถือ แถบเมนูล่าง ความรู้สึกเป็นเพื่อน ไม่เป็นฟอร์ม สีและน้ำเสียงอ่อนโยน ภาษาไทยเป็นธรรมชาติ (รายละเอียดภาพขั้นลงมือใช้ `superripple:impeccable`)

## 5. API

ทุก endpoint ยกเว้น `/auth/login` ต้องมีเซสชันเจ้าของ

| Method | Endpoint | หน้าที่ |
|---|---|---|
| POST | `/auth/login` | เข้าสู่ระบบด้วยรหัสผ่านเจ้าของ |
| POST | `/auth/logout` | ออกจากระบบ |
| POST | `/chat` | ส่งข้อความ รับคำตอบและการกระทำที่จด |
| GET | `/chat/messages` | ประวัติแชท |
| POST | `/chat/actions/:id/undo` | ยกเลิกสิ่งที่จดจากข้อความนั้น |
| GET/POST | `/transactions` | รายการเงิน |
| PATCH/DELETE | `/transactions/:id` | แก้ / ลบ |
| GET/PUT | `/budgets` | งบต่อหมวดและรอบเดือน |
| GET | `/summary/month` | สรุปรายเดือน |
| GET/POST | `/tasks`, PATCH/DELETE `/tasks/:id` | งาน |
| GET/POST | `/events`, PATCH/DELETE `/events/:id` | นัดและตารางเรียน (ซ้ำรายสัปดาห์ได้) |
| GET/POST | `/habits`, PATCH/DELETE `/habits/:id` | นิสัย |
| POST | `/habits/:id/logs` | บันทึกการทำ |
| GET | `/today` | สิ่งที่ต้องทำวันนี้ |
| POST | `/push/subscribe` | ลงทะเบียนอุปกรณ์รับแจ้งเตือน |
| DELETE | `/push/subscribe` | ยกเลิก |
| GET/PUT | `/settings` | ตั้งค่าเตือน |

ใครเรียกได้: เจ้าของเท่านั้น ตัวตั้งเวลาเตือนทำงานภายในเซิร์ฟเวอร์ ไม่มี endpoint สาธารณะ

## 6. Database

เงินเป็นจำนวนเต็มสตางค์ (`BIGINT`) เวลาเก็บเป็น UTC (`DATETIME`) แปลงเป็น Asia/Bangkok ตอนแสดงและตอนคำนวณรอบเดือน

| ตาราง | คอลัมน์ | ความสัมพันธ์ |
|---|---|---|
| `categories` | `id` PK, `name` NOT NULL UNIQUE, `kind` ENUM(income, expense) NOT NULL | ใช้โดย `transactions`, `budgets` |
| `transactions` | `id` PK, `category_id` FK NOT NULL, `amount_satang` BIGINT NOT NULL, `kind` ENUM NOT NULL, `occurred_at` DATETIME NOT NULL, `note` VARCHAR, `source_message_id` FK NULL, `deleted_at` NULL | FK → `categories`, `chat_messages` |
| `budgets` | `id` PK, `category_id` FK NOT NULL, `month` CHAR(7) NOT NULL (YYYY-MM), `limit_satang` BIGINT NOT NULL, UNIQUE(`category_id`,`month`) | FK → `categories` |
| `tasks` | `id` PK, `title` NOT NULL, `priority` TINYINT NOT NULL, `due_at` DATETIME NULL, `status` ENUM(todo, done) NOT NULL, `source_message_id` FK NULL, `deleted_at` NULL | FK → `chat_messages` |
| `events` | `id` PK, `title` NOT NULL, `kind` ENUM(class, appointment) NOT NULL, `starts_at` DATETIME NOT NULL, `ends_at` DATETIME NULL, `repeat_weekly` BOOLEAN NOT NULL, `lead_minutes` INT NULL, `source_message_id` FK NULL, `deleted_at` NULL | FK → `chat_messages` |
| `habits` | `id` PK, `name` NOT NULL, `freq_type` ENUM(daily, per_week, weekdays) NOT NULL, `freq_value` VARCHAR NOT NULL, `deleted_at` NULL | ใช้โดย `habit_logs` |
| `habit_logs` | `id` PK, `habit_id` FK NOT NULL, `day` DATE NOT NULL, UNIQUE(`habit_id`,`day`) | FK → `habits` |
| `reminders` | `id` PK, `kind` ENUM(event, task, budget) NOT NULL, `ref_id` BIGINT NOT NULL, `dedupe_key` VARCHAR NOT NULL UNIQUE, `fire_at` DATETIME NOT NULL, `sent_at` DATETIME NULL, `attempts` INT NOT NULL | อ้าง `events`, `tasks` หรือ `budgets` ตาม `kind` |
| `push_subscriptions` | `id` PK, `endpoint` VARCHAR NOT NULL UNIQUE, `p256dh` NOT NULL, `auth` NOT NULL, `created_at` NOT NULL | ไม่มี |
| `chat_messages` | `id` PK, `role` ENUM(user, bot) NOT NULL, `text` TEXT NOT NULL, `actions_json` JSON NULL, `undone_at` DATETIME NULL, `created_at` NOT NULL | ใช้โดยตารางอื่นผ่าน `source_message_id` |
| `settings` | `key` PK, `value_json` JSON NOT NULL | เก็บเวลาล่วงหน้า ช่วงเงียบ เพดานต่อวัน |

**หมายเหตุออกแบบ:** `dedupe_key` กันเตือนซ้ำ (เช่น `event:12:2026-11-27T15:00:-30`) `deleted_at` ใช้ลบแบบเก็บไว้เพื่อให้ยกเลิกได้ ผู้ใช้คนเดียวจึงไม่มีตารางผู้ใช้ เจ้าของถูกกำหนดด้วยรหัสผ่านใน env

## ตรวจตามข้อกำหนดของ spec

- จดภาษาธรรมชาติ → `/chat`, `chat`, `llm`
- การเงิน/งาน/นิสัย/ตารางเรียน/นัด → `ledger`, `planner`, `habits` และตารางที่เกี่ยวข้อง
- เตือนเรียน นัด งบเกิน เฉพาะที่ตั้งไว้ → `reminders`, `push`, `settings`
- เตือนได้แม้ไม่เปิดแอป และต้องแม่น → ตัวตั้งเวลาในเซิร์ฟเวอร์ตลอดเวลา dedupe ส่งซ้ำเมื่อพลาด ไม่พึ่ง AI
- จดแม่น ทวนทุกครั้ง ถามเมื่อกำกวม ยกเลิกได้ → `chat` ตรวจด้วย zod, `undo`, `deleted_at`
- ถามย้อน → `/summary/month`, ตัวเลขจากฐานข้อมูล
- คุยทั่วไป → `chat` ส่งต่อให้ `llm` เมื่อไม่ใช่คำสั่ง
- ใช้คนเดียวและป้องกัน → `auth`
- ทดสอบได้ → Vitest ทุกแพ็กเกจ `FakeLlm` แทน AI ในเทสต์

**ที่ยังต้องยืนยันจริงก่อนสร้าง:** เวอร์ชัน Node และ MySQL บน VPS, โดเมนและ HTTPS, รุ่นและราคา Claude Haiku 5.5, พฤติกรรม Web Push บน iPhone รุ่นของผู้ใช้
