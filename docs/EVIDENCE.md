# 設計根拠

各機能をなぜその形にしたか、どこまでが確かでどこからが弱いかをまとめる。
アプリ本体は数値や主張を画面に出さない方針なので、根拠はここに集約する。

**この文書はレビュー論文ではない。** 引用は設計判断の出どころを示すためのもので、
効果量や適用範囲は必ず原典で確認すること。また、このアプリは診断・治療を目的と
していない。

---

## 1. 呼吸ガイド

### 共鳴呼吸（5.5秒吸う / 5.5秒吐く）

毎分およそ 5.5 回の呼吸は、呼吸性洞性不整脈と圧受容器反射の位相が揃い、
心拍変動が最大化される帯域として繰り返し報告されている。HRV バイオフィードバックの
中核にある考え方で、実装上も「止める」区間がないため長く続けやすい。

- Lehrer PM, Gevirtz R. *Heart rate variability biofeedback: how and why does it work?*
  Frontiers in Psychology, 2014.

### 生理的ため息（二段で吸って長く吐く）

短時間の呼吸法を比較した無作為化試験で、cyclic sighing（二段吸気＋長い呼気）が
マインドフルネス瞑想や他の呼吸パターンより気分の改善と呼吸数の低下で優れていた。
「1〜3回で十分」という案内はこの知見に沿っている。

- Balban MY, et al. *Brief structured respiration practices enhance mood and reduce
  physiological arousal.* Cell Reports Medicine, 2023.

### 呼気を吸気より長くする配分（4-7-8 を含む）

呼気優位の配分が副交感神経側に働くという生理学的な裏づけは共有されている一方、
**4-7-8 という特定の数字そのものを検証した質の高い試験はほとんどない**。
Andrew Weil による普及が出発点で、実質的には「呼気を長く取る」ことの一形態と
考えるのが妥当。アプリでは 4-7-8 を選べる形にしているが、
より根拠の厚い共鳴呼吸と生理的ため息を同格で並べているのはこのため。

### ボックス呼吸（4-4-4-4）

軍・救急領域で広く使われるが、査読された効果の報告は限定的。
「落ち着かせつつ眠り込みたくない場面」という位置づけに留めている。

---

## 2. サウンド

### 連続ノイズ（ホワイト / ピンク / ブラウン / 雨 / 波）

**主たる作用機序はマスキングである** という前提で作っている。系統的レビューでは、
睡眠補助としての連続ノイズの効果に関する研究は質が低く結論が割れており、
一部には睡眠を悪化させうるという指摘もある。したがってアプリでは
「よく眠れる音」ではなく「物音を消す音」として説明している。

- Riedy SM, Smith MG, Rand S, Basner M. *Noise as a sleep aid: A systematic review.*
  Sleep Medicine Reviews, 2021.

ピンクノイズが徐波睡眠を強めたとする研究はあるが、その多くは
**徐波の位相に同期させて短いノイズバーストを与える** 実験であり、
一晩中連続再生することとは別物である。この区別は重要なので、
アプリはピンクノイズを「低音寄りで耳当たりが柔らかい」としか説明していない。

- Papalambros NA, et al. *Acoustic enhancement of sleep slow oscillations and
  concomitant memory improvement in older adults.* Frontiers in Human Neuroscience, 2017.

音量については、長時間の高い音圧は聴覚への影響が懸念されるため、
既定音量を低く取り、スリープタイマーの終了 1 分前からフェードアウトする設計にした。

### バイノーラルビート

不安や覚醒度への効果を報告する研究はあるが、効果量は小さく、盲検化の難しさもあって
結果は一貫しない。左右の耳に別々の音が届くことが前提なので、スピーカーでは
そもそも成立しない。アプリでは既定でオフ、説明に「ヘッドホン必須」を明記し、
うなり周波数はデルタ〜シータ帯（0.5〜8 Hz）に限定している。

### スリープタイマー

音が一晩中鳴り続けることの是非には定見がないため、既定で切れる方を選んだ。
急に無音になると覚醒しうるので、終了 1 分前から指数フェードで落としている。

---

## 3. NSDR / ヨガニドラ

Non-Sleep Deep Rest（NSDR）は Andrew Huberman による呼称で、実体としては
ヨガニドラや自律訓練法に近い、横臥位での注意誘導。ヨガニドラの介入研究では
睡眠の質や不安の指標の改善が報告されているが、サンプルが小さく対照条件も弱い。
「休息が取れる可能性のある構造化された休憩」として扱うのが妥当で、
アプリも効果を数値で謳っていない。

- Datta K, et al. *Yoga nidra practice shows improvement in sleep in patients with
  chronic insomnia.* Indian Journal of Medical Research, 2021 / 2023 の関連報告群.
- Kjaer TW, et al. *Increased dopamine tone during meditation-induced change of
  consciousness.* Cognitive Brain Research, 2002.（ヨガニドラ中の線条体ドーパミン放出）

台本は体の末端から中心へ注意を移す標準的なボディスキャンの順序に従い、
20 分版は「眠ってしまってよい」、10 分版は「戻ってくる」で終えるよう
終わり方を変えている。

---

## 4. 睡眠ログと床上時間の提案

### なぜ睡眠日誌か

慢性不眠に対する第一選択は薬物ではなく CBT-I（不眠症の認知行動療法）であり、
主要な学会ガイドラインが一致してそう推奨している。CBT-I の出発点は睡眠日誌である。

- Qaseem A, et al. *Management of Chronic Insomnia Disorder in Adults: A Clinical
  Practice Guideline From the American College of Physicians.* Annals of Internal
  Medicine, 2016.
- Edinger JD, et al. *Behavioral and psychological treatments for chronic insomnia
  disorder in adults: an AASM clinical practice guideline.* JCSM, 2021.

### 睡眠効率の計算

睡眠効率 = 総睡眠時間 ÷ 床上時間。実装（`js/sleep-math.js`）では

- 床上時間 = 就床 → 離床
- 総睡眠時間 = （就床 → 起床）− 入眠潜時 − 夜間覚醒

とし、総睡眠時間は床上時間を超えないようにクリップしている。

### 床上時間の増減ルール

睡眠制限法（sleep restriction therapy, Spielman ら）の運用を単純化したもの。

| 直近の平均睡眠効率 | 床上時間 |
|---|---|
| 90% 以上 | 15 分広げる |
| 85〜90% | 維持 |
| 85% 未満 | 15 分狭める |

- 基準の枠は「直近の平均睡眠時間 + 30 分」。
- 枠は 5〜9 時間に収める（5 時間未満に切り下げないのは臨床の慣行に合わせたもの）。
- **起床時刻を固定し、就床時刻のほうを動かす。** これが睡眠制限法の要点。
- 直近 7 日、最低 3 日分の記録を使う。

- Spielman AJ, Saskin P, Thorpy MJ. *Treatment of chronic insomnia by restriction of
  time in bed.* Sleep, 1987.
- Edinger JD, Carney CE. *Overcoming Insomnia: A Cognitive-Behavioral Therapy
  Approach.* Oxford University Press.（効率の閾値と 15 分刻みの運用）

**注意点。** 睡眠制限法は日中の眠気を一時的に強める。睡眠時無呼吸、双極性障害、
てんかん、運転や機械操作を伴う職業では専門家の管理下で行うべき介入であり、
アプリの提案は自己管理の目安にすぎない。この点はフッターの注意書きと、
提案文の「眠くなくても起床時刻は動かさない」という書き方で最低限は伝えている。

---

## 5. 1日のリズム（逆算プランナー）

| 項目 | 時刻 | 根拠 |
|---|---|---|
| 起床時刻の固定 | — | 就寝・起床の変動（社会的時差ぼけ）は睡眠の質と代謝指標の悪化に関連。Wittmann M, et al. *Social jetlag: misalignment of biological and social time.* Chronobiology International, 2006. |
| 起床後の屋外光 10〜30分 | 起床+20分 | 光は概日位相を動かす最も強い因子で、朝の光は位相を前進させる。室内照明でも反応は起きるが、屋外の照度は桁が違う。Zeitzer JM, et al. *Sensitivity of the human circadian pacemaker to nocturnal light.* J Physiol, 2000. |
| 1杯目のカフェイン | 起床+90分 | **生理学的な裏づけは弱い。** 起床直後を避ける習慣は広く言われるが、対照試験の裏づけは乏しい。実害がなく実行しやすいので残しているが、他の項目と根拠の強さが違う。 |
| 仮眠は 20 分まで | 起床+7時間 | 短い仮眠は夜の睡眠圧をあまり削らない。深い睡眠に入る前に切ることで起床時の惰眠感を避ける。長さと時間帯の指定はここから。 |
| カフェイン最終 | 就床−8時間 | 就床 6 時間前のカフェイン 400mg でも客観的な睡眠が有意に乱れた。半減期は個人差が大きく（おおむね 5〜6 時間）、8 時間は安全側に取った値。Drake C, et al. *Caffeine effects on sleep taken 0, 3, or 6 hours before going to bed.* J Clin Sleep Med, 2013. |
| 強めの運動の終わり | 就床−2.5時間 | メタ解析では夕方の運動は睡眠を妨げず、**就床 1 時間前まで続く高強度運動** でのみ悪化が見られた。当初 4 時間前としていたが根拠より厳しすぎるため緩めた。Stutz J, Eiholzer R, Spengler CM. *Effects of Evening Exercise on Sleep in Healthy Participants.* Sports Medicine, 2019. |
| 夕食の終わり | 就床−3時間 | 遅い大きな食事とアルコールは中途覚醒と関連。 |
| ぬるめの入浴 20分 | 就床−2時間 | 40〜42.5℃ の入浴を就床 1〜2 時間前に行うと入眠潜時が短縮した（メタ解析）。末梢血管拡張による深部体温の低下が機序とされる。Haghayegh S, et al. *Before-bedtime passive body heating by warm shower or bath to improve sleep.* Sleep Medicine Reviews, 2019. |
| 照明を落とす | 就床−1.5時間 | 夜の光はメラトニン分泌を抑制し、位相を後退させる。効果量は個人差が大きい。Chang AM, et al. *Evening use of light-emitting eReaders negatively affects sleep.* PNAS, 2015. |
| ウィンドダウン開始 | 就床−1時間 | CBT-I の刺激制御・睡眠衛生の標準的な構成要素。 |
| 眠れなければ床を離れる | 就床後20分 | 刺激制御法。床と覚醒の結びつきを断つ。Bootzin RR. *Stimulus control treatment for insomnia.* 1972 以降の一連の研究。 |

---

## 6. 実装上の判断

- **音源ファイルを持たない。** すべて Web Audio で合成することで、リポジトリを
  数十 KB に保ち、GitHub Pages に置くだけで動くようにした。通信も発生しない。
- **データは端末内のみ。** 睡眠ログは `localStorage` に保存し、外部に送らない。
  CSV 書き出しで手元に取り出せるようにしてある。
- **減光モード。** 就寝直前に画面を見ること自体を推奨はできないので、
  それでも見るなら輝度と色温度を落とす、という妥協として用意した。
- **画面ロック抑止。** 呼吸ガイドと NSDR の再生中だけ Wake Lock を取り、
  終了時に必ず解放する。
- **グラフの設計。** 単一系列なので凡例を置かず、直接ラベルは最新日だけに絞り、
  残りはホバーと表ビューで読めるようにした。バーはゼロ基線から描き、
  軸を切り詰めていない。系列色は暗色サーフェス（`#17130f`）上で
  明度帯・彩度・コントラスト・色覚特性の各条件を満たす値を選んでいる。

---

## 7. 呼吸ガイドの表示形式

当初は「拡がる円」だけで誘導していたが、円の大きさは**いまの状態**しか伝えず、
「あとどれだけ吸えばいいのか」「この息はいつ終わるのか」が読めない。
そこで縦軸に息の深さ（0 = 吐ききり、1 = 吸いきり）をとった波形に置き換えた。

- **波形は右から左へ流れ、「いま」の位置は動かない。** 1呼吸ごとに表示が左端へ
  リセットされる方式（波形を固定してドットが走る形）も試作したが、
  リセットの瞬間に視線が飛ぶ。誘導中は視線が一点に留まるほうがよいと判断した。
- **ドット自身の大きさが息の深さに連動する。** 円の拡縮が持っていた身体的な
  わかりやすさを、波形の上に統合したもの。円を別に置くと画面が縦に伸び、
  視線の移動先が2つになる。
- **カーブはなめらかな正弦の加減速。** 等速の折れ線のほうが「一定のペースで吸う」
  という指示としては厳密だが、実際の呼吸は始まりと終わりがゆっくりで、
  「止める」への移行にも角が立たない。誘導としての追従しやすさを取った。
- **動きを減らす設定（`prefers-reduced-motion`）では流れを止める。** 1呼吸ぶんの
  波形を固定表示し、ドットだけが動く。前庭系に敏感な人にとって画面全体が
  流れ続けるのは負担になりうるため、機能を保ったまま動きの総量を減らしている。
