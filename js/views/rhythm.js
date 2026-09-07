/**
 * 体内リズム・プランナー。
 *
 * 「固定した起床時刻」と「目標の睡眠時間」から就床時刻を決め、そこを基準に
 * 1日の手当て（光・カフェイン・仮眠・運動・入浴・就寝前）の時刻を逆算する。
 * すべて起床からの経過分で持ち、最後に時刻へ変換する。
 */

import { el, toMinutes, toHHMM, formatDuration } from "../util.js";
import { load, save } from "../store.js";

const PREF_KEY = "rhythm-prefs";
const SLEEP_CHOICES = [6, 6.5, 7, 7.5, 8, 8.5, 9];

/**
 * @param {number} bedOffset 起床から就床までの分数
 * @returns {{offset:number, title:string, note:string}[]} 起床からの経過分つき
 */
function buildPlan(bedOffset) {
  const napOffset = Math.min(7 * 60, bedOffset - 6 * 60);

  const items = [
    {
      offset: 0,
      title: "起床・カーテンを開ける",
      note: "毎日ここを動かさないことが、他のどの手当てより効きます。休日もずらすなら1時間以内に。",
    },
    {
      offset: 20,
      title: "屋外の光を10〜30分",
      note: "曇りの屋外でも室内照明よりはるかに明るい。通勤や散歩と兼ねられます。",
    },
    {
      offset: 90,
      title: "1杯目のカフェイン",
      note: "起きた直後より少し置いてから。早すぎると昼過ぎの落ち込みが大きくなりがちです。",
    },
    {
      offset: napOffset,
      title: "仮眠するならこの頃・20分まで",
      note: "長く寝ると夜の眠気を削ります。20分を超えそうならやめておく。",
      skipIf: napOffset < 4 * 60,
    },
    {
      offset: bedOffset - 8 * 60,
      title: "カフェインはここまで",
      note: "半分が体から抜けるまでに5〜6時間かかります。夕方の1杯は夜まで残ります。",
    },
    {
      offset: bedOffset - 150,
      title: "強めの運動はここまで",
      note: "夕方の運動そのものは眠りを妨げません。就床直前の高強度だけ避ければ十分です。",
    },
    {
      offset: bedOffset - 3 * 60,
      title: "夕食を終える",
      note: "遅い大きな食事とアルコールは、夜中に目が覚める原因になります。",
    },
    {
      offset: bedOffset - 2 * 60,
      title: "ぬるめの入浴（20分ほど）",
      note: "湯上がりに体温が下がっていく過程が、寝つきの合図になります。",
    },
    {
      offset: bedOffset - 90,
      title: "照明を落とす",
      note: "天井の照明を消し、手元の暖色だけに。画面も明るさを下げます。",
    },
    {
      offset: bedOffset - 60,
      title: "ウィンドダウン開始",
      note: "仕事とニュースをやめる。呼吸ガイドやNSDRを使うならこの時間帯に。",
    },
    {
      offset: bedOffset,
      title: "就床",
      note: "眠くないまま20分以上たったら、一度床を離れて暗い場所で静かに過ごします。",
    },
  ];

  return items
    .filter((item) => !item.skipIf && item.offset >= 0 && item.offset <= bedOffset)
    .sort((a, b) => a.offset - b.offset);
}

export function render(root) {
  const logPrefs = load("log-prefs", {});
  const prefs = load(PREF_KEY, { wake: logPrefs.riseTime || "07:00", sleepHours: 7.5 });

  const timeline = el("ul", { class: "timeline" });
  const headline = el("div", { class: "callout" });

  const wakeInput = el("input", {
    type: "time", id: "r-wake", value: prefs.wake,
    onchange: (e) => { prefs.wake = e.target.value; save(PREF_KEY, prefs); paint(); },
  });

  const sleepSelect = el("select", { id: "r-sleep", "aria-label": "目標の睡眠時間" });
  for (const hours of SLEEP_CHOICES) {
    sleepSelect.append(el("option", {
      value: String(hours), text: `${hours} 時間`, selected: prefs.sleepHours === hours,
    }));
  }
  sleepSelect.addEventListener("change", () => {
    prefs.sleepHours = Number(sleepSelect.value);
    save(PREF_KEY, prefs);
    paint();
  });

  function paint() {
    const wake = toMinutes(prefs.wake);
    if (wake == null) {
      timeline.replaceChildren(el("li", {}, [el("div", { class: "muted", text: "起床時刻を入力してください。" })]));
      return;
    }

    const sleepMinutes = Math.round(prefs.sleepHours * 60);
    const bedOffset = 1440 - sleepMinutes;

    headline.replaceChildren(
      el("strong", { text: `${toHHMM(wake - sleepMinutes)} 就床 → ${toHHMM(wake)} 起床` }),
      el("div", { class: "muted", style: "margin-top:4px" }, [`目標の睡眠時間 ${formatDuration(sleepMinutes)}`]),
    );

    timeline.replaceChildren(...buildPlan(bedOffset).map((item) => el("li", {}, [
      el("span", { class: "tl-time", text: toHHMM(wake + item.offset) }),
      el("div", {}, [
        el("div", { class: "tl-title", text: item.title }),
        el("div", { class: "tl-note", text: item.note }),
      ]),
    ])));
  }

  paint();

  root.replaceChildren(
    el("h2", { id: "h-rhythm", text: "1日のリズム" }),
    el("p", { class: "lede", text: "起床時刻を固定して、そこから逆算します。夜の対策より、朝と日中の過ごし方のほうが効きます。" }),
    el("div", { class: "card" }, [
      el("div", { class: "field-grid" }, [
        el("div", {}, [el("label", { for: "r-wake", text: "起床時刻" }), wakeInput]),
        el("div", {}, [el("label", { for: "r-sleep", text: "目標の睡眠時間" }), sleepSelect]),
      ]),
      el("div", { style: "margin-top:14px" }, [headline]),
    ]),
    el("div", { class: "card" }, [
      el("h3", { text: "逆算した1日" }),
      timeline,
    ]),
  );

  return () => {};
}
