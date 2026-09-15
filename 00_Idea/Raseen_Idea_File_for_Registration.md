# Raseen (رَصين) — idea file for the Energy Hackathon 2026 registration

**Deadline: registration closes Wednesday 16 September 2026 — submit by Monday 15 September.** Portal: hackathon.moenergy.gov.sa · Track 1 Operational Efficiency · Challenge 2 "Grid stability with variable renewable production" · one idea in one track · team 2–5, all 18+, Saudi nationals or residents, **Saudi team leader**.

**The pitch sentence.** *We don't predict the weather. We predict its operational impact and control the plant, block by block, so the grid sees a schedule instead of a cliff.*

**الجملة العربية.** *لا نتنبأ بالطقس؛ نتنبأ بأثره التشغيلي ونتحكم بالمحطة كتلةً كتلةً، فترى الشبكة جدولاً بدل هاوية.*

**The name.** Raseen — رَصين — composed, steady, unshaken: the plant that keeps its composure when the cloud comes. (The project was called NAJM-3000 until 14 September 2026; NAJM-3000 remains the name of the 3,000 MW reference plant in the twin.)

Fill in the bracketed team roles before submitting. The full concept, physics, numbers and jury answers are in `v4_Raseen_Block_Gradient_Control_13-14-Sep/Raseen_v4_Block_Gradient_Control_Team_Document.md`; the interactive explainer is `v4_Raseen_Block_Gradient_Control_13-14-Sep/Raseen_v4_Block_Gradient_Control_Explainer.html`.

---

## Idea file for registration — Raseen (رَصين) v4.1, 14 September 2026

**Title.** Raseen (رَصين) — Block Gradient Control: a no-storage digital twin controller that turns weather forecasts into a scheduled, declarable ramp for gigawatt solar.

**Track / challenge.** Track 1 Operational Efficiency · Challenge 2 "Grid stability with variable renewable production".

**Problem.** The Kingdom adds ≈ 20 GW of PV a year toward 50 % renewables by 2030. A 3 GW park is ≈ 4 % of the 72.9 GW record peak; a cloud band removes 1,800 MW from it in ten minutes — an N-2 contingency under SERA's planning criteria, absorbed today by reserve that the Grid Code keeps "against weather forecast uncertainties" (SAGC 4.41.15). Operators already receive hours-ahead forecasts; what is missing is the conversion of a forecast into an optimal physical response inside the plant, without buying a battery.

**Solution.** *We don't predict the weather; we predict its operational impact and control the plant, block by block.* Raseen takes the operator's existing external forecast as an input and treats a 3,000 MW plant as thirty spatial blocks. From that forecast and the plant's own sensors it computes each block's cloud arrival and departure time, then drives per-block active-power set-points through the existing PPC so that the plant's export follows a declared gradient — descending before the front, holding a rolling reserve on the blocks the cloud has not reached, re-ascending behind it. Block Gradient Control keeps a firm, declarable reserve (headroom counted only on blocks that stay in the sun), moves reactive duty to shaded inverters, and releases false alarms block by block. Dynamic Solar Headroom — the Code's Delta Regulation made dynamic and spatial — absorbs partial clouds entirely and makes the plant a bidirectional frequency-response provider. Every instruction maps to the Saudi Grid Code (Gradient, Delta, updated Declarations to H-1, 4.46 notification, continuous-monitoring compliance). Built on the team's existing pvlib physics engine and control room, before the plant is commissioned.

**Business model.** Customer: the IPP or its O&M contractor at plants above ~500 MW, and NREP bidders who need declarable ramp behaviour at financial close rather than after commissioning. Product: Raseen is licensed per plant per year (software plus integration to the existing PPC), with an optional share of System Service revenue once National Grid SA contracts the Rolling Solar Reserve under SAGC 2.14.1. Why now: the May 2026 Grid Code created the instruction set (Gradient, Delta Regulation, Declarations to H-1) and the 2030 target creates the plants — the two did not exist together before 2026. Market: about 12.5 GW of PV in operation at end-2025 in roughly twenty plants, every NREP award since 2023 at 1–2 GW per plant, and ≈ 20 GW a year being added toward a stated 2030 pathway of the order of 100–130 GW of renewables, most of it PV — on the order of 50–80 gigawatt-scale plants by 2030, each one a licence.

**What it does not do.** Predict weather (the forecast is an input); control loads; instruct the TSO; simulate ride-through; require storage.

**Emerging technologies.** Digital twin; physics-informed impact nowcasting; spatio-temporal optimisation of inverter set-points; IoT/SCADA/PPC integration; geospatial visualisation.

**Data.** K.A.CARE Renewable Resource Atlas (1-minute irradiance); NCM dust forecasts; the operator's forecast feed (mocked); Ministry of Energy open data (peak load, consumption by operational region); GASTAT 2024 energy statistics; SAGC May 2026, SADC June 2026, SERA TPC 2025.

**Expected impact.** A 1,800 MW cliff delivered as a 900 MW, 3 %/min scheduled ramp with ≥ 10 minutes' notice for ≈ 1 % of a day's energy; partial clouds made invisible to the grid; a declarable solar reserve without a battery — at roughly one-tenth to one-fifteenth of the annual cost of a battery block for the same ramp service.

**Team.** [Leader — Saudi national]; [physics engine]; [data and nowcast]; [control and optimisation]; [control room]. Eligibility: 2–5 members, 18+, Saudi nationals or residents; leader and at least one member attend 7–9 October in person.

### ملف الفكرة — النسخة العربية

**العنوان.** رَصين — التحكم بالتدرّج الكتلي: متحكم توأم رقمي بلا تخزين يحوّل توقعات الطقس إلى منحدر مجدول ومُعلَن لمحطات الطاقة الشمسية الجيجاواطية.

**المسار / التحدي.** مسار الكفاءة التشغيلية — التحدي الثاني «استقرار الشبكة الكهربائية مع تغير إنتاج الطاقة المتجددة».

**المشكلة.** تضيف المملكة نحو 20 جيجاواط من الطاقة الشمسية سنوياً للوصول إلى 50٪ من الطاقة المتجددة بحلول 2030. تمثل محطة 3 جيجاواط نحو 4٪ من الحمل الذروي القياسي البالغ 72.9 جيجاواط؛ وتزيل سحابة كثيفة 1,800 ميجاواط منها خلال عشر دقائق — حالة طوارئ من نوع N-2 بموجب معايير التخطيط لدى هيئة تنظيم الكهرباء، تُمتصّ اليوم باحتياطي يحتفظ به الكود الكهربائي «مقابل عدم يقين توقعات الطقس» (4.41.15). المشغلون يتلقون أصلاً توقعات قبل ساعات؛ والغائب هو تحويل التوقع إلى استجابة فيزيائية مثلى داخل المحطة، من دون شراء بطارية.

**الحل.** *لا نتنبأ بالطقس؛ نتنبأ بأثره التشغيلي ونتحكم بالمحطة كتلةً كتلةً.* يأخذ رَصين توقعات الطقس التي يمتلكها المشغّل أصلاً كمُدخل — فالتنبؤ بالطقس ليس ابتكارنا — ويعامل محطة 3,000 ميجاواط كثلاثين كتلة مكانية. من ذلك التوقع ومن مستشعرات المحطة نفسها يحسب زمن وصول الظل ومغادرته لكل كتلة، ثم يقود نقاط ضبط القدرة الفاعلة لكل كتلة عبر متحكم المحطة القائم بحيث يتبع تصدير المحطة تدرّجاً مُعلناً — ينخفض قبل الجبهة، ويحتفظ باحتياطي متدحرج على الكتل التي لم تبلغها السحابة، ويرتفع خلفها. يحافظ «التحكم بالتدرّج الكتلي» على احتياطي مؤكَّد قابل للإعلان (هامش يُحتسب فقط على الكتل التي تبقى تحت الشمس)، وينقل واجب القدرة غير الفاعلة إلى العواكس المظلَّلة، ويفكّ الإنذارات الكاذبة كتلةً كتلة. و«هامش الطاقة الشمسية الديناميكي» — وهو «تنظيم دلتا» في الكود مُحوَّلاً إلى نمط ديناميكي مكاني — يمتصّ السحب الجزئية كلياً ويجعل المحطة مزوّداً ثنائي الاتجاه للاستجابة الترددية. كل تعليمة تصدر عنه لها بند في الكود السعودي للشبكة (التدرّج، دلتا، الإعلانات المحدّثة حتى ساعة قبل الوقت الفعلي، إشعار 4.46، الامتثال بالمراقبة المستمرة). مبني على محرك pvlib وغرفة التحكم الموجودَين لدى الفريق، قبل التشغيل التجريبي.

**نموذج العمل.** العميل: المنتج المستقل للطاقة أو مقاول التشغيل والصيانة في المحطات التي تتجاوز نحو 500 ميجاواط، والمطوّرون المتنافسون في جولات البرنامج الوطني للطاقة المتجددة الذين يحتاجون سلوك منحدر قابلاً للإعلان عند الإغلاق المالي لا بعد التشغيل. المنتج: ترخيص سنوي لكل محطة (برمجيات وتكامل مع متحكم المحطة القائم)، مع حصة اختيارية من إيراد خدمة النظام عند تعاقد الشركة السعودية للشبكة على «الاحتياطي الشمسي المتدحرج» بموجب البند 2.14.1. لماذا الآن: كود الشبكة (مايو 2026) أوجد مجموعة التعليمات (التدرّج، تنظيم دلتا، الإعلانات حتى ساعة قبل الوقت الفعلي)، وهدف 2030 يوجد المحطات — ولم يجتمع الاثنان قبل 2026. السوق: نحو 12.5 جيجاواط شمسية عاملة بنهاية 2025 في نحو عشرين محطة، وكل ترسية منذ 2023 بقدرة 1–2 جيجاواط للمحطة، ونحو 20 جيجاواط تُضاف سنوياً — أي ما يقارب 50–80 محطة جيجاواطية بحلول 2030، كل منها ترخيص.

**ما لا يفعله.** لا يتنبأ بالطقس (التوقع مُدخل)، ولا يتحكم بالأحمال، ولا يوجّه تعليمات لمشغل النقل، ولا يحاكي تجاوز الأعطال، ولا يحتاج تخزيناً.

**التقنيات الناشئة.** التوأم الرقمي؛ التنبؤ القريب بالأثر المستند إلى الفيزياء؛ التحسين المكاني-الزمني لنقاط ضبط العواكس؛ تكامل إنترنت الأشياء/سكادا/متحكم المحطة؛ التصور الجغرافي.

**البيانات.** أطلس الموارد المتجددة (إشعاع بدقة دقيقة)؛ توقعات الغبار للمركز الوطني للأرصاد؛ تغذية توقعات المشغل (محاكاة)؛ البيانات المفتوحة لوزارة الطاقة (الحمل الذروي، الاستهلاك حسب المناطق التشغيلية)؛ إحصاءات الطاقة 2024؛ الكود السعودي للشبكة مايو 2026، كود التوزيع يونيو 2026، معايير تخطيط النقل 2025.

**الأثر المتوقع.** هاوية 1,800 ميجاواط تُسلَّم كمنحدر مجدول بـ900 ميجاواط بمعدل 3٪/دقيقة مع إشعار مسبق لا يقل عن 10 دقائق مقابل نحو 1٪ من طاقة اليوم؛ سحب جزئية لا تراها الشبكة؛ احتياطي شمسي قابل للإعلان بلا بطارية — بنحو عُشر إلى جزء من خمسة عشر من الكلفة السنوية لوحدة بطارية للخدمة نفسها.

**الفريق.** [قائد الفريق — سعودي]؛ [المحرك الفيزيائي]؛ [البيانات والتنبؤ القريب]؛ [التحكم والتحسين]؛ [غرفة التحكم]. الأهلية: 2–5 أعضاء، فوق 18 عاماً، سعوديون أو مقيمون؛ يحضر القائد وعضو واحد على الأقل حضورياً في 7–9 أكتوبر.

---
