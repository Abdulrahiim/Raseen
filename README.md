<p align="center">
  <img src="app/raseen/web/logo.svg" width="140" alt="Raseen">
</p>

<h1 align="center">Raseen · رَصين</h1>

<p align="center">
  <b>Predictive gradient control for gigawatt solar.<br>The cloud changes the output; Raseen controls its effect on the grid.</b>
</p>

<p align="center">
  <b>السحاب يغيّر الإنتاج، ورَصين يتحكم بأثره على الشبكة.</b>
</p>

<p align="center">
  <a href="#english">English</a> ·
  <a href="#arabic">العربية</a> ·
  <a href="https://abdulrahiim.github.io/Raseen/">Live demo</a> ·
  <a href="https://youtu.be/2FxrKreAqsM">Video</a>
</p>

---

<a name="english"></a>

## English

*رَصين — composed, steady, unshaken: the plant that keeps its composure when the cloud comes.*

> We don't predict the weather. We predict its operational impact and control the plant,
> block by block, so the grid sees a schedule instead of a cliff.

Raseen is an integrated platform for utility-scale photovoltaic plants. It begins by simulating
weather fluctuations on a digital twin of the plant and ends by issuing proactive control
commands that turn a sudden production drop into a declared, scheduled ramp inside the grid
code — from within the plant, without batteries.

### The problem

A gigawatt solar plant is one large surface exposed to the sky. When a cloud front or a dust
storm crosses it, output falls in minutes, and the transmission operator sees a cliff instead
of a schedule.

| | |
|---|---|
| **60+ dust storms a year** | cover the Kingdom repeatedly; the plant's behaviour during the storm becomes a critical part of the operating decision. |
| **65 % drop in 10 minutes** | has been recorded at a solar plant. The few minutes available are the heart of the crisis. |
| **8+ GWh of batteries** | are already commissioned in the Kingdom. Discharging them to steady the grid at the moment of crisis needs an accurate forecast that *precedes* the event. |

Five faces of the same problem:

- continuous variability of renewable output;
- a permanent threat to grid frequency stability;
- sharp, sudden drops when clouds cross the array;
- forecasts that fail to become an operating decision;
- the high cost of batteries as the answer to output swings.

### The solution: three layers in one platform

1. **A proactive digital twin.** Raseen simulates the effect of weather fluctuations on the
   plant's sectors before they arrive, to estimate the operational risk and prepare for it.
2. **An intelligent decision engine.** It analyses the twin's data, selects the most suitable
   operating strategy, and determines where and when to intervene in the plant to keep the
   output stable.
3. **Execution and control commands.** It turns the decision into executable set-points that
   shape the gradient gradually and respond to the event quickly, with minimal human
   intervention.

### How it works: the cloud crossing, step by step

1. **The plant in a digital environment.** Raseen represents the plant in a complete digital
   environment that mirrors its components and their operational layout, and provides the basis
   for simulating events, forecasting their effect and testing control decisions.
2. **When the cloud moves, the grid feels it.** Raseen simulates the passage of clouds over the
   PV plant, which can cause a rapid change in power and push the *ramp rate* at the point of
   interconnection (POI) beyond the permitted limits.
3. **We see the problem before it arrives.** Raseen does not wait for the drop to happen. It
   analyses the expected changes in weather and cloud motion through the digital twin and turns
   them into a spatial and temporal forecast of their effect on the plant.
4. **The twin: where will the cloud strike?** Raseen simulates the expected cloud path on the
   plant model to determine where, when and how much each PV block will be affected, and
   estimates the power available during the event.
5. **The decision.** Before the cloud arrives, Raseen computes the minimum *Dynamic Headroom*
   required to cover the expected deficit, while avoiding a larger curtailment than necessary.
6. **The moment of execution.** If the power available on the unaffected blocks is sufficient,
   Raseen curtails gradually to build a *Predictive Dynamic Headroom* that can be released when
   the change hits — `Headroom ≥ Expected Ramp Deficit`.
7. **The cloud moves, Raseen releases.** As PV blocks are shaded, Raseen releases the available
   power from the blocks still under irradiance, so the change in power at the POI stays within
   the permitted limit.
8. **When the event exceeds the plant.** Raseen does not assume the plant can compensate for
   everything. If the expected deficit exceeds the internal reserve, it declares a *Ramp Event*
   early, giving the operator time to activate external grid reserves.
9. **The twin goes beyond clouds.** The digital twin also injects virtual faults to test the
   response of plant components and expose weaknesses before real operation.

### The physics of the ramp

A 3,000 MW plant is not one generator; it is thirty control blocks spread over kilometres, and a
cloud crosses them one after another over several minutes. Raseen derives each block's arrival
and departure time and drives per-block active-power set-points through the existing Power Plant
Controller, so the plant's export follows a smooth, pre-declared gradient: descending ahead of the
front, holding a rolling reserve on the blocks the cloud has not reached, re-ascending behind it.

The energy that shapes the ramp is a thin slice of sunshine deliberately not exported for a few
minutes — no battery, no new hardware, no new grid rights. The governing relation is

```
g = D / (τ + L)
```

where the declared gradient `g` fixes how much lead time `L` the controller needs for a deficit
`D` over a transit time `τ`.

| Reference case | |
|---|---|
| Plant | 30 control blocks × 100 MW = 3,000 MW |
| Event | 1,800 MW deficit over a 10-minute transit |
| Declared gradient | 90 MW/min (3 % of plant capacity per minute) |
| Maximum ten-minute drop at the POI | **1,800 MW → 900 MW** |
| Natural ramp severity | **180 → 90 MW/min**, 50 % calmer |
| Notice to the transmission operator | a scheduled ramp declared **≥ 10 minutes** before the front |
| Declarable reserve | **150 MW** of confirmed margin on the blocks far from the cloud |

### Forecasting, learning and optimisation

Raseen's intelligence is layered: physics first, machine learning where it earns its place, and
optimisation for the decision itself.

- **Physics.** A pvlib clear-sky reference and the plant model give the expected output of every
  station; lag-correlation of irradiance across the array gives the shadow's speed, heading and
  depth. From these the twin computes each block's shadow arrival time and duration.
- **Machine learning.** Gradient-boosted models (LightGBM / scikit-learn) trained on the plant's
  own telemetry and weather feeds correct the residuals of the external forecast and attach
  confidence bands (P50 / P90) to every block's arrival time and depth, and score the
  probability that a coming front becomes a ramp event. The models are interpretable, run on
  physics features, and keep learning as the plant accumulates operating history.
- **Optimisation.** A linear program (SciPy) allocates the headroom across blocks: which block
  holds how much, so that the declared gradient is met at the lowest spill, within every block's
  and the plant controller's limits.

The weather forecast is an *input* to Raseen. What Raseen produces is the operational forecast —
where the shadow lands, when, how deep, and what to do about it.

### Technology stack

| Layer | Technologies |
|---|---|
| Physics & digital twin | Python · pvlib · pandas |
| AI & optimisation | scikit-learn · LightGBM · SciPy |
| Service & control room | FastAPI · MapLibre GL · Three.js |
| Plant integration & operations | Modbus TCP · IEC 61850 · OPC UA |

### The value

- **Ramp-shaping cost** for solar falls from about **110–130 million SAR a year** to about
  **7–8 million SAR a year** — a potential annual difference of **102–123 million SAR**.
- **Maximum drop** during the event halves, from **1,800 MW to 900 MW**, with a **50 %**
  lower ramp rate and a lead time of **at least 10 minutes**.
- **More than 150 cases** — control strategies and injected faults — can be tested on the digital
  twin before real operation, on a model covering **365 stations** in **30 control blocks**.

### Economics of the reference plant

| Item | Detail | Value |
|---|---|---|
| Managed capacity | reference solar plant, 30 control blocks × 100 MW | 3,000 MW |
| Annual production | nameplate × 8,760 h × 28.5 % capacity factor | 7,489,800 MWh |
| Ramp events a year | 55 days of significant cloud cover × 2 events a day | 110 events |
| Events Raseen handles | 90 % activation × 98 % availability | 97 events (88 %) |
| Target | shape 88 % of ramp events for a **2.0 %** curtailment of annual energy | |
| Ramp severity at the POI | from 180 MW/min natural to 90 MW/min declared | 50 % calmer |
| Maximum ten-minute drop | from 1,800 MW to 900 MW at the POI | 50 % lower |
| Notice to the transmission operator | from none to a scheduled ramp declared before the front | 10 minutes |
| Declarable reserve | confirmed margin on the blocks far from the cloud | 150 MW |
| Cost per declarable MW | from 124,235 SAR (battery) to 11,000 SAR a year | 91 % cheaper |
| Time to operation | from 30 months for a battery to six for a software integration | 80 % faster |
| Cost to the plant owner | 7,500,000 licence + 814,099 value of curtailed energy, plus 4,100,000 initial investment | 8,314,099 SAR a year |

Three ways of valuing the alternative, from floor to ceiling:

| Layer | Comparison | Result |
|---|---|---|
| Floor | The existing plant controller alone, with plant-level pre-curtailment: the same energy is spilled with no declared reserve. | net cost 7,710,642 SAR a year |
| **Realistic (adopted)** | Raseen re-sizes 225 MW / 61 MWh out of a multi-service battery the owner would build anyway. | **saves 19,221,182 SAR a year** |
| Theoretical ceiling | A 900 MW battery dedicated to ramp control alone — nobody builds it, and the figure is not presented as the claim. | 100,077,762 SAR a year |

On the adopted realistic layer: **net present value 189 million SAR · benefit-to-cost 3.2× · cost
equivalent to 5.0 % of plant revenue · 3,000 MW reference plant.**

### Business model

| | |
|---|---|
| **Customers** | developers and operators of large solar plants · the transmission operator and the power-procurement company · renewable-project financiers · O&M companies |
| **Value** | higher grid reliability by damping sudden drops in solar output · lower plant-stabilisation cost by reducing dependence on large batteries, for a limited sacrifice of energy · a fast, scalable software solution that integrates with existing PPC and SCADA systems · applicable across many plants and blocks |
| **Key partners** | the energy ministry and electricity regulator · the national grid operator · the power-procurement company · the renewable-energy research and development city · PPC and inverter vendors |
| **Key activities** | block-level gradient control · per-block cloud-impact forecasting · integration with the plant controller · verification and compliance documentation |
| **Key resources** | the digital twin of a 3 GW plant · renewable-resource atlas data · algorithm IP · a control and operations-room team |
| **Customer relationships** | system-service contracts with the operator · direct integration in the control room · continuous engineering support and calibration · automatic compliance reports after every event |
| **Channels** | a pilot on an existing plant · plant-controller vendors · the service written into new-project requirements |
| **Revenue** | annual SaaS subscription per gigawatt · integration and commissioning fees · a share of system-service revenue · technology licensing and compliance studies |
| **Costs** | software development and team · cloud hosting and edge compute · integration and calibration per plant · energy not exported while shaping the ramp |

Headline commitments: **3 %/min declared ramp · advance notice from hours ahead down to a declared
ramp ≥ 10 minutes before the front · no dependence on batteries.**

### Delivery path

| # | Stage | Content |
|---|---|---|
| 1 | Define the problem and the grid standards | cloud triggers and grid-code limits |
| 2 | Build the database and sources | irradiance, weather and plant measurements |
| 3 | Build the spatial digital twin | the plant as thirty spatial blocks |
| 4 | Develop near-term impact forecasting | shadow arrival time for every block |
| 5 | Dynamic reserve algorithm | how much to curtail, and where |
| 6 | Gradient controller and operating commands | set-points through the plant controller |
| 7 | Control room and verification | measure the ramp against the code |
| 8 | Pilot operation and scale-up | from a reference plant to the Kingdom |

### What is in this repository

```
Raseen/
├── app/                the application: controller, simulation, API and dashboard
│   ├── raseen/         geometry · shadow fields · control · scenario · registry · web assets
│   ├── najm3000/       plant physics engine and supervisory dashboard
│   ├── config/         plant configuration (project, equipment, blocks, data sources)
│   ├── tools/          static-site builder for the GitHub Pages demo
│   └── tests/          geometry, shadow, controller, scenario and web-app tests
├── docs/               the pre-rendered static site GitHub Pages serves
└── render.yaml         blueprint for deploying the live backend
```

`app/README.md` is the engineering reference: module layout, configuration variables, the
static build and the container deploy.

### The dashboard

| Page | What it shows |
|---|---|
| **Kingdom** | Saudi utility-scale renewable projects and the 380 kV transmission backbone on a map, with layer, technology and status filters. |
| **Plant · Overview** | The supervisory desk of the reference plant (*Humaij*, 3,000 MWac): the 363-station site on satellite imagery, the block layout, a 3D drill-down, expected-vs-measured trends and fault injection. |
| **Plant · Gradient control** | The cloud crossing: power at the connection point with the held headroom shaded under it, a readout of what the cloud took and what the blocks still in sun gave back, the set-point of every station grouped into the 30 control blocks, and sliders for the cloud's speed, size, position and direction. Two response strategies are computed for every cloud — the **declared ramp** (export descends at the declared gradient, headroom held on the blocks the cloud reaches last) and **pre-hold and backfill** (every block held down evenly ahead of the front; the blocks still in sun raise their output when it lands, so export stays flat). *Replay the event* walks through it at a chosen speed with a forecast briefing and operator notices. *Explain this page* gives a guided tour; the theme switch selects light or dark. |

The live demo at <https://abdulrahiim.github.io/Raseen/> runs the full control loop in the
browser on the reference plant, so every slider and button is live.

### Run it locally

From the repository root:

```powershell
cd app
python -m venv .venv
.venv\Scripts\python.exe -m pip install -e ".[dev]"
.venv\Scripts\python.exe -m raseen            # http://127.0.0.1:8000
```

The first request builds the plant model (~20 s); after that it is quick. The app lands on the
Kingdom page; the sidebar switches pages. The maps use Esri's keyless tile services and need
internet — both fall back to a drawn plan if tiles or WebGL are unavailable.

Tests and lint (from `app/`):

```powershell
.venv\Scripts\python.exe -m pytest
.venv\Scripts\python.exe -m ruff check raseen tests
```

### Rebuilding the static demo

GitHub Pages serves static files only, so `tools/build_static.py` pre-renders the dashboard
into `docs/` — the pages, their assets, the registry and geometry as JSON, and a day bundle for
the Plant page. On the static build the cloud crossing runs in the browser through
`app/raseen/web/engine.js`, a port of the Python engine held to it by a test.

```powershell
.venv\Scripts\python.exe tools\build_static.py          # regenerate ../docs
.venv\Scripts\python.exe -m http.server -d ..\docs      # preview at http://localhost:8000
```

`docs/` on `main` is what the live demo serves, so committing a rebuilt `docs/` publishes it.

---

<a name="arabic"></a>

<div dir="rtl" align="right">

## العربية

*رَصين: ثابت، رزين، لا يهتزّ. المحطة التي تحفظ رصانتها حين تأتي السحابة.*

> لا نتنبأ بالطقس؛ نتنبأ بأثره التشغيلي ونتحكم بالمحطة كتلةً كتلةً، فترى الشبكة جدولاً بدل هاوية.

رَصين منصة متكاملة لمحطات الطاقة الشمسية الكهروضوئية بحجم الجيجاواط. تبدأ بمحاكاة تقلبات الطقس على توأم رقمي للمحطة، وتنتهي بإصدار أوامر تحكم استباقية تحوّل هبوط الإنتاج المفاجئ إلى منحدر مُعلن ومجدول ضمن حدود كود الشبكة، من داخل المحطة ودون بطاريات.

**نتحكم بالأثر.. لاستقرارٍ بدلاً عن هاوية.**

### المشكلة

المحطة الشمسية بحجم الجيجاواط سطح واحد كبير مكشوف للسماء. حين تعبرها جبهة سحابية أو عاصفة غبارية يهبط إنتاجها في دقائق، فيرى مشغّل النقل هاوية لا جدولاً.

| | |
|---|---|
| **أكثر من 60 عاصفة غبارية سنوياً** | تشمل المملكة بشكل متكرر، ويصبح سلوك المحطة أثناء العاصفة جزءاً حاسماً من قرار التشغيل. |
| **هبوط 65٪ في 10 دقائق** | رُصد في إنتاج محطة شمسية. والدقائق القليلة المتاحة هي جوهر الأزمة. |
| **أكثر من 8 جيجاواط.ساعة من البطاريات** | شُغّلت فعلياً في المملكة. وتفريغها لاستقرار الشبكة وقت الأزمة يحتاج توقعاً دقيقاً *يسبق* الحدث. |

خمسة وجوه للمشكلة نفسها:

- التذبذب المستمر لإنتاج الطاقة المتجددة؛
- التهديد الدائم لاستقرار تردد الشبكة؛
- الانخفاض الحاد والمفاجئ عند عبور السحب؛
- عجز التنبؤ الحالي عن التحوّل إلى قرار تشغيلي؛
- ارتفاع تكلفة البطاريات كحلٍّ لتغيرات الإنتاج.

### الحل: ثلاث طبقات في منصة واحدة

1. **توأم رقمي استباقي.** يحاكي رَصين أثر التقلبات الجوية على قطاعات المحطة قبل وصولها، لتقدير المخاطر التشغيلية والاستعداد لها.
2. **نظام قرارات ذكي.** يحلل بيانات التوأم الرقمي ويحدد استراتيجية التشغيل الأنسب، وأين ومتى يجب التدخل في أجزاء المحطة للحفاظ على استقرار الإنتاج.
3. **تنفيذ وأوامر تحكم.** يحوّل القرار إلى أوامر تحكم قابلة للتنفيذ، لضبط التدرّج تدريجياً والاستجابة للحدث بسرعة وبأقل تدخل بشري.

### كيف يعمل: قصة عبور السحابة خطوةً خطوة

1. **المحطة في بيئة رقمية.** يمثّل رَصين المحطة في بيئة رقمية متكاملة تحاكي مكوناتها وتوزيعها التشغيلي، وتوفر أساساً لمحاكاة الأحداث والتنبؤ بتأثيرها واختبار قرارات التحكم.
2. **عندما تتحرك السحابة، تتأثر الشبكة.** يحاكي رَصين أثر مرور السحب فوق المحطة الكهروضوئية، مما قد يسبب تغيراً سريعاً في القدرة يدفع معدل التغيّر (Ramp Rate) عند نقطة الربط (POI) إلى تجاوز الحدود المسموحة.
3. **نرى المشكلة قبل أن تصل.** لا ينتظر رَصين هبوط الإنتاج حتى يحدث؛ بل يحلل التغيرات المتوقعة في الطقس وحركة السحابة عبر التوأم الرقمي، ويحوّلها إلى توقع مكاني وزماني لتأثيرها على المحطة.
4. **التوأم الرقمي: أين ستضرب السحابة؟** يحاكي رَصين مسار السحابة المتوقع على نموذج المحطة ليحدد أين ومتى وكم ستتأثر كل كتلة، ويقدّر القدرة المتاحة أثناء الحدث.
5. **اتخاذ القرار.** قبل وصول السحابة يحسب رَصين الحد الأدنى من الهامش الديناميكي (Dynamic Headroom) المطلوب لتعويض العجز المتوقع، مع تجنب خفض إنتاج أكبر من اللازم.
6. **لحظة التنفيذ.** إذا كانت القدرة المتاحة في الكتل غير المتأثرة كافية، يخفض رَصين التغذية تدريجياً لإنشاء هامش ديناميكي استباقي قابل للتحرير عند حدوث التغير: `Headroom ≥ Expected Ramp Deficit`.
7. **السحابة تتحرك، ورَصين يحرّر.** عندما تتأثر الكتل، يحرر رَصين القدرة المتاحة من الكتل التي ما زالت تحت الإشعاع، بحيث يبقى التغير في القدرة عند نقطة الربط ضمن الحد المسموح.
8. **عندما يتجاوز الحدث قدرة المحطة.** لا يفترض رَصين أن المحطة تستطيع تعويض كل شيء. إذا تجاوز العجز المتوقع قدرة الاحتياطي الداخلي، يعلن مبكراً عن حدث منحدر (Ramp Event) لإتاحة الوقت لتفعيل احتياطي الشبكة الخارجي.
9. **التوأم الرقمي يتجاوز السحب.** لا يكتفي رَصين بإدارة الأحداث الجوية؛ يتيح التوأم الرقمي محاكاة الأعطال وحقن أعطال افتراضية لاختبار استجابة مكونات المحطة وكشف نقاط الضعف قبل التشغيل الفعلي.

### فيزياء المنحدر

محطة بقدرة 3,000 ميجاواط ليست مولّداً واحداً؛ بل ثلاثون كتلة تحكم ممتدة على كيلومترات، تعبرها السحابة كتلةً بعد أخرى خلال عدة دقائق. يستنتج رَصين زمن وصول الظل ومغادرته لكل كتلة، ويقود نقاط ضبط القدرة الفعلية لكل كتلة عبر متحكم المحطة القائم، فيتبع تصدير المحطة منحدراً سلساً مُعلناً مسبقاً: ينخفض قبل الجبهة، ويحتفظ باحتياطي متحرك على الكتل التي لم تصلها السحابة، ويعود للارتفاع خلفها.

الطاقة التي تشكّل المنحدر شريحة رقيقة من الإشعاع لا تُصدَّر عن قصد لبضع دقائق: لا بطارية، ولا عتاد جديد، ولا حقوق شبكة جديدة. والعلاقة الحاكمة هي:

<div dir="ltr">

```
g = D / (τ + L)
```

</div>

حيث يحدد التدرّج المُعلن `g` زمن الاستباق `L` الذي يحتاجه المتحكم لعجز `D` خلال زمن عبور `τ`.

| الحالة المرجعية | |
|---|---|
| المحطة | 30 كتلة تحكم × 100 ميجاواط = 3,000 ميجاواط |
| الحدث | عجز 1,800 ميجاواط خلال عبور مدته 10 دقائق |
| التدرّج المُعلن | 90 ميجاواط/دقيقة (3٪ من قدرة المحطة في الدقيقة) |
| أقصى هبوط خلال عشر دقائق عند نقطة الربط | **من 1,800 إلى 900 ميجاواط** |
| حدة المنحدر الطبيعية | **من 180 إلى 90 ميجاواط/دقيقة**، أهدأ بنسبة 50٪ |
| الإشعار المسبق لمشغّل النقل | منحدر مجدول يُعلَن **قبل 10 دقائق على الأقل** من وصول الجبهة |
| الاحتياطي القابل للإعلان | **150 ميجاواط** هامش مؤكَّد على الكتل البعيدة عن السحابة |

### التنبؤ والتعلّم والتحسين

ذكاء رَصين طبقات: الفيزياء أولاً، والتعلّم الآلي حيث يستحق مكانه، والتحسين لاتخاذ القرار.

- **الفيزياء.** مرجع السماء الصافية من pvlib ونموذج المحطة يعطيان الإنتاج المتوقع لكل محطة فرعية؛ والارتباط الزمني للإشعاع عبر المصفوفة يعطي سرعة الظل واتجاهه وعمقه. ومنها يحسب التوأم زمن وصول الظل ومدته لكل كتلة.
- **التعلّم الآلي.** نماذج التعزيز المتدرّج (LightGBM / scikit-learn) المدرَّبة على قياسات المحطة نفسها وتغذيات الطقس تصحّح بواقي التنبؤ الخارجي، وتُلحق بكل كتلة نطاقات ثقة (P50 / P90) لزمن الوصول والعمق، وتقدّر احتمال تحوّل الجبهة القادمة إلى حدث منحدر. النماذج قابلة للتفسير، تعمل على خصائص فيزيائية، وتستمر في التعلّم مع تراكم تاريخ تشغيل المحطة.
- **التحسين.** برنامج خطي (SciPy) يوزّع الهامش على الكتل: أي كتلة تحتفظ بكم، بحيث يُحقَّق التدرّج المُعلن بأقل فقد ممكن، ضمن حدود كل كتلة وحدود متحكم المحطة.

توقعات الطقس *مدخل* لرَصين. أما ما ينتجه رَصين فهو التوقع التشغيلي: أين يحلّ الظل، ومتى، وبأي عمق، وماذا نفعل حياله.

### التقنيات المستخدمة

| الطبقة | التقنيات |
|---|---|
| محرك الفيزياء والتوأم الرقمي | Python · pvlib · pandas |
| محرك الذكاء الاصطناعي والتحسين | scikit-learn · LightGBM · SciPy |
| الخدمة وغرفة التحكم | FastAPI · MapLibre GL · Three.js |
| التكامل مع المحطة والتشغيل | Modbus TCP · IEC 61850 · OPC UA |

### القيمة المضافة

- **خفض تكلفة تشكيل المنحدر** من نحو **110–130 مليون ريال سنوياً** إلى نحو **7–8 ملايين ريال سنوياً** من الطاقة الشمسية، أي فرق سنوي محتمل يقارب **102–123 مليون ريال**.
- **خفض أقصى هبوط** خلال الحدث من **1,800 إلى 900 ميجاواط**، أي خفض معدل المنحدر بنسبة **50٪**، مع زمن استباق لا يقل عن **10 دقائق**.
- **إتاحة اختبار أكثر من 150 حالة** على التوأم الرقمي قبل التشغيل الفعلي، تشمل سيناريوهات التحكم والأعطال، على نموذج يغطي **365 محطة فرعية** في **30 كتلة تحكم**.

### الجدوى الاقتصادية للمحطة المرجعية

| البند | التفاصيل | القيمة |
|---|---|---|
| القدرة المُدارة | محطة شمسية مرجعية مقسّمة إلى 30 كتلة تحكم × 100 ميجاواط | 3,000 ميجاواط |
| الإنتاج السنوي | القدرة الاسمية × 8,760 ساعة × معامل سعة 28.5٪ | 7,489,800 م.و.س |
| أحداث المنحدر السنوية | 55 يوماً ذا غطاء سحابي مؤثر × حدثان مؤثران في اليوم | 110 أحداث |
| الأحداث التي يعالجها رَصين | نسبة تفعيل 90٪ × توافر النظام 98٪ | 97 حدثاً (88٪) |
| الاستهداف | تشكيل 88٪ من أحداث المنحدر مقابل تقليص **2.0٪** فقط من الطاقة السنوية | |
| حدة المنحدر عند نقطة الربط | من 180 ميجاواط/دقيقة طبيعية إلى 90 ميجاواط/دقيقة مُعلنة | أهدأ بـ 50٪ |
| أقصى هبوط خلال عشر دقائق | من 1,800 ميجاواط إلى 900 ميجاواط عند نقطة الربط | أقل بـ 50٪ |
| الإشعار المسبق لمشغّل النقل | من لا شيء إلى منحدر مجدول يُعلَن قبل وصول الجبهة | 10 دقائق |
| الاحتياطي القابل للإعلان | هامش مؤكَّد على الكتل البعيدة عن السحابة | 150 ميجاواط |
| تكلفة الميجاواط القابل للإعلان | من 124,235 ريالاً بوحدة البطارية إلى 11,000 ريال سنوياً | أرخص بـ 91٪ |
| زمن النشر حتى التشغيل | من 30 شهراً لبطارية إلى ستة أشهر لتكامل برمجي | أسرع بـ 80٪ |
| تكلفة رَصين على مالك المحطة | ترخيص 7,500,000 + قيمة الطاقة المقلَّصة 814,099، مع استثمار أولي 4,100,000 | 8,314,099 ريالاً سنوياً |

ثلاث طبقات لتقييم البديل، من الأرضية إلى السقف:

| الطبقة | المقارنة | النتيجة |
|---|---|---|
| الأرضية | متحكم المحطة القائم وحده، لو اكتفى المالك بالتقليص التمهيدي على مستوى المحطة: يهدر الطاقة نفسها بلا احتياطي مُعلن. | تكلفة صافية 7,710,642 ريالاً/سنة |
| **الواقعي (المعتمد)** | يعيد رَصين تحجيم 225 ميجاواط / 61 م.و.س من بطارية متعددة الخدمات يبنيها المالك أصلاً. | **وفر 19,221,182 ريالاً/سنة** |
| السقف النظري | بطارية 900 ميجاواط مخصصة لضبط المنحدر وحده: لا يبنيها أحد، ولا يُعرض هذا الرقم كادّعاء. | 100,077,762 ريالاً/سنة |

الأساس المعتمد هو الطبقة الواقعية: **صافي قيمة حالية 189 مليون ريال · المنفعة إلى التكلفة 3.2 ضعف · تكلفة تعادل 5.0٪ من إيراد المحطة · محطة مرجعية 3,000 ميجاواط.**

### نموذج العمل

| | |
|---|---|
| **شرائح العملاء** | مطوّرو ومشغّلو المحطات الشمسية الكبرى · مشغّل نقل الكهرباء وشركة شراء الطاقة · مموّلو مشاريع الطاقة المتجددة · شركات التشغيل والصيانة |
| **القيمة المقدمة** | رفع موثوقية الشبكة بتخفيف الانخفاضات المفاجئة في إنتاج المحطات الشمسية · خفض تكلفة استقرار المحطة بتقليل الاعتماد على البطاريات الضخمة، مقابل التضحية بنسبة محدودة من الطاقة · حل برمجي سريع وقابل للتوسع يُدمج مع أنظمة PPC وSCADA القائمة · قابل للتطبيق على محطات وكتل شمسية متعددة |
| **الشراكات الرئيسية** | وزارة الطاقة وهيئة تنظيم الكهرباء · المشغّل الوطني للشبكة · الشركة السعودية لشراء الطاقة · مدينة الملك عبدالله للطاقة المتجددة · مورّدو متحكمات المحطات والعواكس |
| **الأنشطة الرئيسية** | التحكم بالتدرّج الكتلي · التنبؤ بأثر السحب لكل كتلة · التكامل مع متحكم المحطة · التحقق وتوثيق الامتثال |
| **الموارد الرئيسية** | توأم رقمي لمحطة 3 جيجاواط · بيانات أطلس الموارد المتجددة · الملكية الفكرية للخوارزميات · فريق تحكم وغرفة عمليات |
| **العلاقات مع العملاء** | عقود خدمة نظام مع المشغّل · تكامل مباشر في غرفة التحكم · دعم هندسي ومعايرة مستمرة · تقارير امتثال آلية بعد كل حدث |
| **القنوات** | تجربة رائدة على محطة قائمة · مورّدو متحكمات المحطات · اشتراط الخدمة في المشاريع الجديدة |
| **مصادر الإيرادات** | اشتراك سنوي لكل جيجاواط بنظام SaaS · رسوم تكامل وتشغيل أولي · حصة من عوائد خدمة النظام · ترخيص التقنية ودراسات الامتثال |
| **هيكل التكاليف** | تطوير البرمجيات ورواتب الفريق · الاستضافة السحابية والحوسبة الطرفية · التكامل والمعايرة لكل محطة · الطاقة غير المصدَّرة أثناء تشكيل المنحدر |

الالتزامات الرئيسية: **منحدر مُعلن 3٪ في الدقيقة · إشعار مسبق يبدأ من ساعات قبل الحدث وينتهي بمنحدر مُعلن قبل 10 دقائق على الأقل من وصول الجبهة · عدم الاعتماد على البطاريات.**

### خطة العمل

| # | المرحلة | المحتوى |
|---|---|---|
| 1 | تحديد المشكلة ومعايير الشبكة | مصدّرات السحب وحدود الكود |
| 2 | بناء قاعدة البيانات والمصادر | الإشعاع والطقس وقياسات المحطة |
| 3 | بناء التوأم الرقمي المكاني | المحطة ثلاثون كتلة مكانية |
| 4 | تطوير التنبؤ القريب بالأثر | زمن وصول الظل لكل كتلة |
| 5 | خوارزمية الاحتياطي الديناميكي | كم نقلّص، وأين |
| 6 | متحكم التدرّج وأوامر التشغيل | نقاط الضبط عبر متحكم المحطة |
| 7 | غرفة التحكم والتحقق | قياس المنحدر أمام الكود |
| 8 | التشغيل التجريبي والتوسع | من محطة مرجعية إلى المملكة |

### ما في هذا المستودع

<div dir="ltr">

```
Raseen/
├── app/                التطبيق: المتحكم، المحاكاة، الواجهة البرمجية ولوحة التحكم
│   ├── raseen/         الهندسة المكانية · حقول الظل · التحكم · السيناريوهات · السجل · أصول الويب
│   ├── najm3000/       محرك فيزياء المحطة ولوحة الإشراف
│   ├── config/         إعدادات المحطة (المشروع، المعدات، الكتل، مصادر البيانات)
│   ├── tools/          باني الموقع الثابت لعرض GitHub Pages
│   └── tests/          اختبارات الهندسة والظل والمتحكم والسيناريوهات وتطبيق الويب
├── docs/               الموقع الثابت المُصيَّر مسبقاً الذي تقدمه GitHub Pages
└── render.yaml         مخطط نشر الخادم الحي
```

</div>

`app/README.md` هو المرجع الهندسي: تخطيط الوحدات، ومتغيرات الإعداد، والبناء الثابت، ونشر الحاوية.

### لوحة التحكم

| الصفحة | ما تعرضه |
|---|---|
| **المملكة** | مشاريع الطاقة المتجددة السعودية بالمقياس الكبير وشبكة النقل 380 ك.ف على خريطة، مع مرشحات للطبقات والتقنية والحالة. |
| **المحطة · نظرة عامة** | مكتب الإشراف للمحطة المرجعية (*هميج*، 3,000 ميجاواط تيار متردد): موقع 363 محطة فرعية على صور الأقمار الاصطناعية، وتوزيع الكتل، وتفصيل ثلاثي الأبعاد، ومنحنيات المتوقع مقابل المقاس، وحقن الأعطال. |
| **المحطة · التحكم بالتدرّج** | عبور السحابة: القدرة عند نقطة الربط والهامش المحتفَظ به مظللاً تحتها، وقراءة لما أخذته السحابة وما أعادته الكتل التي ما زالت تحت الشمس، ونقطة ضبط كل محطة فرعية مجمَّعة في 30 كتلة تحكم، ومنزلقات لسرعة السحابة وحجمها وموضعها واتجاهها. تُحسب استراتيجيتا استجابة لكل سحابة: **المنحدر المُعلن** (ينخفض التصدير بالتدرّج المُعلن، والهامش محفوظ على الكتل التي تصلها السحابة أخيراً) و**الحجز المسبق والتعويض** (تُخفَّض كل الكتل بالتساوي قبل الجبهة؛ وترفع الكتل التي ما زالت تحت الشمس إنتاجها عند وصولها، فيبقى التصدير ثابتاً). *إعادة عرض الحدث* تمرّ به بسرعة مختارة مع إحاطة تنبؤية وتنبيهات للمشغّل. *اشرح هذه الصفحة* تقدّم جولة موجَّهة، ومفتاح السمة يختار الوضع الفاتح أو الداكن. |

العرض الحي على <https://abdulrahiim.github.io/Raseen/> يشغّل حلقة التحكم كاملةً في المتصفح على المحطة المرجعية، فكل منزلق وزر فيه فعّال.

### التشغيل محلياً

من جذر المستودع:

<div dir="ltr">

```powershell
cd app
python -m venv .venv
.venv\Scripts\python.exe -m pip install -e ".[dev]"
.venv\Scripts\python.exe -m raseen            # http://127.0.0.1:8000
```

</div>

يبني الطلب الأول نموذج المحطة (نحو 20 ثانية) ثم يصير سريعاً. يفتح التطبيق على صفحة المملكة، والشريط الجانبي يبدّل الصفحات. تستخدم الخرائط خدمات Esri بلا مفتاح وتحتاج اتصالاً بالإنترنت، وتعود إلى مخطط مرسوم إن لم تتوفر البلاطات أو WebGL.

الاختبارات والفحص (من داخل `app/`):

<div dir="ltr">

```powershell
.venv\Scripts\python.exe -m pytest
.venv\Scripts\python.exe -m ruff check raseen tests
```

</div>

### إعادة بناء العرض الثابت

تقدّم GitHub Pages ملفات ثابتة فقط، لذلك يصيّر `tools/build_static.py` لوحة التحكم مسبقاً إلى `docs/`: الصفحات وأصولها، والسجل والهندسة المكانية بصيغة JSON، وحزمة يوم لصفحة المحطة. في البناء الثابت يعمل عبور السحابة في المتصفح عبر `app/raseen/web/engine.js`، وهو نقل لمحرك Python يثبّته اختبار.

<div dir="ltr">

```powershell
.venv\Scripts\python.exe tools\build_static.py          # regenerate ../docs
.venv\Scripts\python.exe -m http.server -d ..\docs      # preview at http://localhost:8000
```

</div>

`docs/` على `main` هو ما يقدّمه العرض الحي، فالالتزام بـ `docs/` مُعاد بناؤه ينشره.

</div>
