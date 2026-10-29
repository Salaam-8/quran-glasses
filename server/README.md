# السيرفر القرآني: تعرّف على التلاوة على سيرفرك المجاني

سيرفر صغير يستقبل الصوت من تطبيق «مصحف النظارة» ويرجع النص لحظيًا بنموذج Whisper مدرّب على تلاوة القرآن
(`tarteel-ai/whisper-base-ar-quran`، رخصة Apache-2.0). بلا طنين، بلا حدود ساعات، ويعمل من أي متصفح.

المكوّنات: `asr_server.py` (البث عبر WebSocket) + Docker + Caddy (شهادة HTTPS مجانية تلقائيًا).

---

## أولًا: سيرفر مجاني على Oracle Cloud (مرة واحدة، نحو ساعة)

Oracle تقدم خطة **Always Free** دائمة: جهاز ARM بأربعة أنوية و24 جيجا ذاكرة بلا رسوم. تحتاج بطاقة بنكية للتحقق فقط ولا يُخصم منها شيء ما دمت في حدود المجاني.

1. **الحساب:** https://signup.cloud.oracle.com ← سجّل ← اختر Home Region قريبة (مثل **Saudi Arabia Central (Riyadh)** أو **UAE East (Dubai)**). لا يمكن تغييرها لاحقًا.
2. **إنشاء الجهاز:** من القائمة ← Compute ← Instances ← **Create instance**
   - Name: `quran-asr`
   - Image and shape ← **Edit** ← Image: **Ubuntu 22.04** (أو 24.04) ← Shape: **Ampere** ← **VM.Standard.A1.Flex** ← OCPU: **4**، Memory: **24 GB** (هذا كله ضمن المجاني).
   - Networking: اتركه يُنشئ VCN جديدة، وتأكد أن **Assign a public IPv4 address** مفعّل.
   - Add SSH keys: اختر **Generate a key pair for me** وحمّل المفتاح الخاص (`ssh-key-xxxx.key`) واحفظه.
   - **Create**. إن ظهر «Out of capacity» للـ A1 فأعد المحاولة لاحقًا أو جرّب Availability Domain آخر؛ هذا شائع ويُحل بالتكرار.
3. **فتح المنافذ 80 و443 في الشبكة:** افتح الجهاز ← Primary VNIC ← Subnet ← **Default Security List** ← **Add Ingress Rules**:
   - Source CIDR `0.0.0.0/0`، IP Protocol TCP، Destination Port Range `80` ← Add.
   - وكرّرها للمنفذ `443`.
4. **الدخول إلى الجهاز** من PowerShell على ويندوز (من المنزل، فبروكسي الشركة قد يمنع SSH):
   ```powershell
   ssh -i C:\path\to\ssh-key-xxxx.key ubuntu@PUBLIC_IP
   ```
5. **فتح المنافذ في جدار الجهاز نفسه** (صور Oracle تمنع كل شيء عدا SSH):
   ```bash
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
   sudo netfilter-persistent save
   ```
6. **تثبيت Docker:**
   ```bash
   curl -fsSL https://get.docker.com | sudo sh
   sudo usermod -aG docker ubuntu && newgrp docker
   ```

## ثانيًا: اسم مجاني للسيرفر (DuckDNS)

يلزم اسم نطاق حتى يحصل Caddy على شهادة HTTPS، والمتصفح لا يسمح بالمايك إلا عبر HTTPS.

1. https://www.duckdns.org ← سجّل الدخول بحساب Google أو GitHub.
2. اكتب اسمًا فرعيًا (مثل `quran-salo`) ← **add domain**.
3. في خانة **current ip** ضع عنوان IP العام لجهاز Oracle ← **update ip**.
4. اسم السيرفر صار: `quran-salo.duckdns.org`.

## ثالثًا: تشغيل السيرفر

على جهاز Oracle (عبر SSH):

```bash
git clone https://github.com/Salaam-8/quran-glasses.git
```
الريبو خاص، فسيطلب اسم المستخدم وكلمة مرور: استخدم **Personal access token** من GitHub (Settings ← Developer settings ← Fine-grained tokens ← صلاحية Contents: Read على هذا الريبو) بدل كلمة المرور.
بديل بلا توكن: من PowerShell على ويندوز انسخ مجلد السيرفر فقط:
```powershell
scp -i C:\path\to\ssh-key-xxxx.key -r C:\path\to\quran-glasses\server ubuntu@PUBLIC_IP:~/server
```

ثم:
```bash
cd ~/quran-glasses/server      # أو cd ~/server
cp .env.example .env
nano .env                      # DOMAIN=quran-salo.duckdns.org  و ASR_TOKEN=رمز طويل عشوائي
docker compose up -d --build
docker compose logs -f asr     # أول تشغيل يحمّل النموذج ويحوّله (5–10 دقائق). انتظر سطر "listening on :8765"
```

تحقق من المتصفح: `https://quran-salo.duckdns.org/health` يجب أن تعرض `ok`.

## رابعًا: في التطبيق

«محرك الصوت» ← **سيرفر قرآني** ← رابط السيرفر `https://quran-salo.duckdns.org` ← الرمز السري = قيمة `ASR_TOKEN` ← «تشغيل تتبّع الصوت». الشريحة تصبح «يستمع… (السيرفر)».

## صيانة

- تحديث الكود: `git pull && docker compose up -d --build`
- السجلات: `docker compose logs -f asr`
- نموذج أسرع وأقل دقة: في `.env` غيّر `ASR_MODEL_ID=tarteel-ai/whisper-tiny-ar-quran` ثم `docker compose up -d`
- Oracle قد يوقف الأجهزة المجانية **الخاملة** جدًا. لو حدث، أعد تشغيله من لوحة التحكم؛ أو فعّل Oracle الخطة المدفوعة Pay-As-You-Go (تبقى الموارد المجانية مجانية) فلا يُوقف.

## الاختبار بلا نموذج (للمطورين)

```bash
pip install numpy websockets
python3 tests/test_server.py                       # سياسة البث والبروتوكول بنموذج مزيّف
ASR_FAKE=1 ASR_PORT=8765 python3 server/asr_server.py   # سيرفر مزيّف للتجربة محليًا
```
