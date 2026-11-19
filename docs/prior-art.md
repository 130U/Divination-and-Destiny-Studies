# Prior art

A browser-only BaZi reading with a language model touches four bodies of work: open charting code, published
astronomical calendars, bring-your-own-key AI clients and the provider's own interface. I studied each before
designing the product. This page records what each establishes, where it stops, and what Divination and Destiny
Studies takes from it or adds beyond it.

## The short version

| Work | What it establishes | Where it stops | What this product does |
| --- | --- | --- | --- |
| [Zhenyi-bazi](https://github.com/ZHENYI-ORG/Zhenyi-bazi) | A complete open BaZi calendar: solar terms, four pillars, hidden stems, Ten Gods, Na Yin, luck cycles | Its solar-term table sits on a fixed UTC+8 clock, and its entry point reads the whole chart from one wall clock | Vendors five files unchanged and wraps them in a split clock with minute enumeration |
| [lunar-javascript](https://github.com/6tail/lunar-javascript) | The widely used Chinese calendar library, with eight characters among its outputs | Answers "what are the pillars of this moment?"; an uncertain birth time is left to the caller | Turns exact, range and unknown times into the complete set of distinct charts |
| Hong Kong Observatory and NAOJ calendars | Published minutes of every solar term | Reference tables, not code | Serve as test fixtures that no charting library produced |
| [NextChat](https://github.com/ChatGPTNextWeb/NextChat) and BYOK clients | Visitors can bring their own model keys to a static web app | The key is persisted in browser storage and outlives the visit | Holds the key in one closure that dies with the tab |
| [DeepSeek API](https://api-docs.deepseek.com/) | JSON output and adjustable reasoning effort | A transport, silent on business validity | Adds candidate identity checks, evidence citations, usage per call and no automatic retry |
| [BaZi Context Agent](https://github.com/130U/ENGINEERING-BaZi-Context-Agent) | A 27-question bank in three groups, and the rule that the chart is fixed before context is read | Keeps models off the ranking entirely | Lets the model compare candidates, with arithmetic and evidence frozen first |

## Notes

### Zhenyi-bazi

An MIT-licensed charting system in the blind-school lineage, with its calendar shipped as plain JavaScript: Gregorian
and lunar conversion, solar terms, the four pillars, hidden stems, Ten Gods, Na Yin and the start and sequence of
luck cycles, plus a true-solar-time calculator with an equation-of-time table. It is the most complete open calendar
core I found, and I use five of its files unchanged, pinned to commit `383a726` with a SHA-256 manifest that the
tests check.

Two of its conventions needed work around them. `GetAdjustedJQ` adds one third of a day to every solar-term Julian
date, which places the table on UTC+8; comparing it with another time zone's wall clock moves a boundary that occurs
at one instant worldwide. And its entry point evaluates the whole chart on one effective wall clock and, for a
repeated clock time, picks the earlier instant. The wrapper keeps the vendored files intact and separates the
coordinates: year and month on the UTC+8 timeline of the absolute instant, day and hour on the chosen local or
true-solar clock, every interpretation of a repeated minute retained.

### lunar-javascript

6tail's library is a widely used open Chinese calendar, covering solar and lunar dates, solar terms, festivals and
the eight characters. It answers the question every charting tool asks: what
are the pillars of this moment? A person who knows only "early morning" or nothing at all poses a different question,
which charts are possible at all, and that is left to the caller. Divination and Destiny Studies answers it directly:
for an unknown time it walks all 1,440 minutes of the day, skips and reports clock times that do not exist, keeps
both readings of a repeated time, and merges only minutes whose four pillars match exactly.

### Hong Kong Observatory and National Astronomical Observatory of Japan

Both publish the minute of each solar term for the year. They are the right ground truth for a calendar engine
because they were produced by neither the upstream library nor this wrapper. The tests place instants two minutes
before and after the published Lichun and Jingzhe minutes and check the year and month change, Lichun falling on the
previous civil date in New York, identical year and month pillars across time zones, and invariance under
true-solar correction.

### NextChat and bring-your-own-key clients

NextChat, one of the most widely used open-source chat front ends, shows how far a static web app can go when each
visitor supplies a key: no backend, no shared bill. It stores its access settings, keys included, in a persisted
browser store, so the key survives a reload and stays readable to anything that later runs on the origin. That is a
reasonable choice for a daily chat tool and the wrong one for a single reading. Here the key lives in one closure in
the current tab, is never written to storage, a URL, a log or an export, and is erased on refresh, on leaving the
page, or on clearing. The page's content security policy allows connections only to its own origin and the official
endpoint.

### DeepSeek API

The provider's documentation defines JSON output mode and reasoning effort, including that a requested `medium` is
served at `high`. A transport cannot say whether an answer is valid for the business. The client accepts only a
complete JSON answer with usage counts, rejects truncation, caps size and time, and never retries a paid request;
the workflow then checks candidate identity and citations before anything reaches the report.

### BaZi Context Agent

The sibling project and the source of the 27-question bank, reused with its question IDs, wording, options and
applicability conditions. It keeps every model off the ranking and asks about the present only after the chart is
locked. This product takes the opposite position on purpose: the model compares candidates, because weighing a life
against several charts is interpretation. What makes that safe is the same principle applied differently: the
arithmetic and the evidence are fixed before the model speaks, and everything it says is checked against them.

## Where the product goes further

1. **A split clock.** Solar terms keep their instant in every time zone while day and hour pillars follow the local
   or true-solar clock.
2. **Complete candidate sets.** Exact, range and unknown times become every distinct chart at one-minute resolution.
3. **A model that interprets and never calculates.** Two calls over frozen data, with candidate identity enforced.
4. **Claims that cite answers.** Evidence IDs, warnings and usage in every report; blanks are never facts.
5. **A key that dies with the tab.** Bring-your-own-key without persistence, proxies or automatic retries.
