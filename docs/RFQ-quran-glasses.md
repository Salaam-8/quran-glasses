# Request for Quotation (RFQ): Prayer-Reading AR Glasses

**Project code:** QG-1 · **Issued:** 2026-10-30 · **Status:** Draft for supplier outreach · **Confidential**

> ## ملخص عربي لشريكي
> هذا ملف طلب عرض أسعار نرسله للمصانع. يصف ما نحتاجه بالضبط في نظارة قراءة المصحف أثناء الصلاة، ويترك للمصنع
> أن يقترح: إما نظارة جاهزة من إنتاجه نضع عليها علامتنا (المسار A، أسرع وأرخص)، أو تصميم مخصص بعدسات موجية (المسار B).
> المرحلة الحالية لا تكلفة فيها غير النظارة التي عندنا؛ التكاليف الحقيقية تبدأ مع العينات ثم الإنتاج.
> الأرقام المطلوبة من كل مصنع: سعر العينة، وأسعار ٥٠ و٢٠٠ و١٠٠٠ قطعة، والحد الأدنى للطلب، والمدة.
> قائمة المصانع المقترحة وبيانات التواصل في `docs/manufacturers.md`.

---

## 1. Who we are and what we are building

We are a small team in Saudi Arabia building **a Quran reader for AR glasses used during prayer**. The glasses
show the verses of the Quran floating in front of the worshipper on a pure-black background (black = transparent),
follow the recitation by voice, highlight the current verse and word, and hide the text automatically when the head
drops for bowing and prostration (using the glasses' head-tracking sensor).

A working prototype exists today on an off-the-shelf pair of consumer AR glasses (VITURE, birdbath optics,
3-DoF IMU, USB-C DisplayPort) driven by a web app. Our software stack is ready; we are now looking for a hardware
partner for a branded product.

We are asking for quotations on two tracks. Please quote **either or both**:

| Track | What we want from you | Why |
|---|---|---|
| **A. White-label existing design** | One of your existing binocular video/AR glasses (birdbath or similar), with our brand, our packaging, minor firmware/button changes, and documented access to the IMU and buttons | Fastest path to a sellable product |
| **B. Custom design** | A new, lighter design built on a waveguide (or a slim birdbath) optical module, possibly with onboard compute, co-developed with us | Target product for the second generation |

---

## 2. Use-case constraints that drive the requirements

- Worn for **5–60 minutes at a time**, standing, bowing, and prostrating; must stay in place and be comfortable over a prayer cap.
- Used in **mosques**: lighting ranges from dim to bright indoor light; **no camera** is strongly preferred (privacy).
- The wearer's **hands are not free**: paging and control happen by **voice**, **head posture** and at most **two or three physical buttons**.
- Text is **right-to-left Arabic script** in a Quranic font; it must stay crisp at small sizes.
- Black pixels must render **fully transparent** so only the text appears to float; no visible "screen rectangle".
- The upper part of the field of view is not usable on some birdbath designs (dark edge); we need uniform brightness across the visible area.

---

## 3. Requirements

"M" = must have, "S" = should have, "N" = nice to have.

### 3.1 Optics and display
| # | Requirement | Priority |
|---|---|---|
| O1 | Binocular display, both eyes show the same image (no 3D needed) | M |
| O2 | Resolution ≥ 1920 × 1080 per eye (Track A); ≥ 640 × 480 per eye acceptable for a monochrome waveguide (Track B) | M |
| O3 | Field of view ≥ 40° diagonal (birdbath) or ≥ 30° (waveguide) | M |
| O4 | Brightness to the eye ≥ 400 nits (birdbath) / ≥ 1000 nits (waveguide), adjustable by the user and by software | M |
| O5 | Black level: black pixels appear transparent; contrast ≥ 1000:1 (OLED / micro-LED) | M |
| O6 | Brightness uniformity ≥ 80% across the field of view; no dark band at the top | S |
| O7 | Monochrome green micro-LED acceptable for Track B; full color preferred for Track A | S |
| O8 | Transparent (see-through) optics; the room must stay visible | M |
| O9 | Diopter adjustment or clip-in prescription frame | S |
| O10 | Electrochromic / dimming front shade | N |

### 3.2 Host interface (Track A: tethered)
| # | Requirement | Priority |
|---|---|---|
| H1 | USB-C with **DisplayPort Alt Mode**, plug-and-play with Android phones (Samsung Galaxy S-series) and Windows/macOS laptops, no driver | M |
| H2 | Display presents as a standard 1080p60 monitor (EDID) | M |
| H3 | Power drawn from the host ≤ 2.5 W typical | S |
| H4 | Cable length ≥ 1.2 m, detachable or replaceable | S |

### 3.3 Standalone option (Track B)
| # | Requirement | Priority |
|---|---|---|
| C1 | Onboard SoC able to run Android (e.g. Snapdragon AR1 / AR1+ or MediaTek) with our app pre-installed | S |
| C2 | Wi-Fi + Bluetooth; microphone for on-device speech recognition | S |
| C3 | Battery ≥ 2 h continuous display at 50% brightness; USB-C charging | S |
| C4 | Alternatively: a pocket compute puck connected by cable | N |

### 3.4 Sensors
| # | Requirement | Priority |
|---|---|---|
| S1 | **3-DoF IMU** (gyro + accelerometer, magnetometer optional) with on-device fusion, ≥ 100 Hz | M |
| S2 | IMU data accessible from the host over the **same USB-C cable** as a HID device (or documented USB protocol), readable from Windows, Android and Chrome (WebHID) **without a proprietary app** | M |
| S3 | Full protocol or SDK documentation under NDA, including command set and data format | M |
| S4 | Wear-detection (proximity) sensor | S |
| S5 | No camera; if a camera exists it must have a hardware switch or be removable | S |

### 3.5 Audio and controls
| # | Requirement | Priority |
|---|---|---|
| A1 | ≥ 2 microphones with noise suppression, exposed to the host as a standard **USB Audio Class** device | M |
| A2 | Open-ear speakers (optional, can be omitted to save weight) | N |
| A3 | 2–3 physical buttons; each must send a **standard HID keyboard key** (configurable, e.g. Page Down / Page Up / Pause) in addition to any native volume function | M |
| A4 | Buttons usable by touch without looking, with tactile feedback | S |

### 3.6 Mechanical
| # | Requirement | Priority |
|---|---|---|
| M1 | Weight ≤ 85 g (Track A), ≤ 50 g target (Track B) | M / S |
| M2 | Stays in place during bowing and prostration: adjustable nose pads, optional strap or temple grips | M |
| M3 | Fits over a prayer cap / with a head covering; temple length adjustable | S |
| M4 | Operating temperature 0–45 °C; no condensation issues in air-conditioned halls | S |
| M5 | Case and cleaning cloth included | N |

### 3.7 Firmware, software and licensing
| # | Requirement | Priority |
|---|---|---|
| F1 | A unique, readable **serial number** over USB (used by our license system) | M |
| F2 | Firmware update tool for Windows and Android | S |
| F3 | Custom boot logo and our brand name in device descriptors (USB product string) | S |
| F4 | For Track B: ability to lock the device to our app (kiosk mode) | S |
| F5 | SDK / sample code for Android (Kotlin or C) and Windows | S |

### 3.8 Branding, compliance and supply
| # | Requirement | Priority |
|---|---|---|
| B1 | Our logo on the frame and packaging; Arabic + English manual and packaging | M |
| B2 | CE, FCC, RoHS; **SASO / IECEE** certificate for Saudi Arabia (or support obtaining it) | M |
| B3 | Warranty ≥ 12 months; spare parts (nose pads, cable) available for 3 years | S |
| B4 | Samples: 2–5 engineering samples within 4 weeks of order | M |
| B5 | Pilot order of 50–200 units; mass production from 1,000 units | M |

---

## 4. What we will supply

- The application (web app today; Android app in progress), the Quran text data and fonts.
- Our brand assets, packaging artwork and Arabic manuals.
- Test protocols for the IMU posture detection and for the display (black level, brightness, text legibility).
- A license server; the device only needs to expose its serial number.

---

## 5. What we ask you to send back

1. Which track(s) you can serve and the **model(s)** you propose, with full datasheets.
2. A filled copy of the requirement tables above with **Compliant / Partial / No** per line and comments.
3. **Prices** (USD, FOB Shenzhen/Hong Kong or DDP Riyadh) for: engineering sample · 50 · 200 · 1,000 units.
4. NRE / tooling cost for branding changes (Track A) or the custom design (Track B), and the development schedule (EVT → DVT → PVT → MP).
5. MOQ, lead time, payment terms, warranty terms.
6. The **IMU protocol or SDK** (under NDA) and a statement on the HID key-mapping of the buttons.
7. Existing certificates (CE/FCC/RoHS) and whether you have shipped to Saudi Arabia (SASO).
8. References: brands you have manufactured for in AR / video glasses.
9. Your NDA template, or acceptance of ours.

**Timeline:** we would like to receive proposals within 2 weeks, order samples within 4 weeks, and place a pilot order after sample validation.

---

## 6. Contact

Project lead: *(name)* · Email: *(email)* · WhatsApp: *(number)* · Location: Saudi Arabia
Preferred language: English (Arabic also fine). All information in this document is confidential.

---

## Appendix A: Email template for first contact

> Subject: RFQ – Branded AR glasses for a prayer Quran reader (Track A: white-label / Track B: custom)
>
> Dear Sales Team,
>
> We are a Saudi team with a working prototype of a Quran reader for AR glasses used during prayer (text floats on a
> transparent black background, voice tracking, head-posture auto-hide). We are selecting a manufacturing partner for a
> branded product and would like your quotation.
>
> Attached is our requirements document (RFQ QG-1). The key needs are: binocular see-through display with true black
> transparency, USB-C DisplayPort plug-and-play, a 3-DoF IMU readable over USB as a HID device, 2–3 buttons that send
> standard keyboard keys, microphones as USB audio, no camera, under 85 g, and SASO support for Saudi Arabia.
>
> Could you please tell us which of your existing models fit (white-label), or propose a custom design, with prices
> for samples, 50, 200 and 1,000 units, MOQ and lead time? We can sign an NDA to receive the IMU protocol/SDK.
>
> Best regards,
> *(name, company, WhatsApp)*

## Appendix B: Glossary for non-technical readers

- **Birdbath optics**: the common design in today's consumer AR glasses (VITURE, XREAL): bright, full color, ~45° field of view, slightly bulkier, dark edge at the top of the view on some models.
- **Waveguide**: thin transparent lens that looks like normal glasses; lighter and more discreet, usually dimmer and often monochrome green. Used by Meta-Bounds, Cellid, Lingxi AR reference designs.
- **DisplayPort Alt Mode**: the way a phone or laptop sends video over USB-C with no driver.
- **HID**: the standard USB class for keyboards, mice and sensors; it lets our app read the glasses' sensor and buttons in any operating system and in Chrome.
- **3-DoF IMU**: the motion sensor that tells us how the head is tilted (for bowing and prostration).
- **EVT / DVT / PVT / MP**: engineering, design, production validation, then mass production.
- **SASO**: the Saudi product-safety certification required to import and sell electronics.
