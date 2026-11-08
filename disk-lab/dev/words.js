// Words that change with the state of the page, in both languages (the fixed text is in index.html, in .en/.ja spans).
// Rules (DESIGN.md, section 4): short and exact; a technical term is said plainly once; units with numbers.

// The citation, one line in English for both languages (round 8)
const CITE_LINE = (y, url, v) => `Mori, S. ${y}, Disk Lab: an interactive model of a protoplanetary disk (v${v}), ${url}`;
// (round 11b) the credit burned into each frame of a video, small, in its lower right: in English for both languages, as the citation
const CREDIT_LINE = (y, url) => `Disk Lab (Mori ${y}) · ${url.replace(/^https?:\/\//, '').replace(/\/$/, '')}`;
// (round 13a) the names of the colours the model look lets one choose, by the engine's keys (app.js, COMPS' cols), for the colours'
// words under show (round 18d: one map for the colour's input and its own chip; and the field lines', drawn over the picture)
const COLS_JA = { disk: 'ガス', rock: '小石(岩)', ice: '小石(氷)', wind: '円盤風', jet: 'ジェット', env: 'エンベロープ', field: '磁力線' };
const COLS_EN = { disk: 'Gas', rock: 'Pebbles (rock)', ice: 'Pebbles (ice)', wind: 'Wind', jet: 'Jet', env: 'Envelope', field: 'Field lines' };

export const WORDS = {
  ja: {
    places: {
      whole: { short: '全体', title: '円盤の全体',
        text: '若い星を回るガスと塵の円盤(半径およそ 30 au)。惑星はこうした円盤で生まれます。星の光が反り返った表層を温め、赤道面は冷たいまま。円盤を貫く線は磁力線、上に淡く光るのは円盤風です。最初は 10 au に木星質量の惑星を置き、時計を止めています(「時間」の再生ボタンで動き出します)。' },
      wind: { short: '磁場と風', title: '磁場と円盤風',
        text: '円盤を貫く磁力線は、回転にねじられながら外へ開きます。ガスはこの線に沿って加速し、風となって上下に吹き出します。磁場が回転と同じ向きなら、風は片側で強くなります。' },
      snow: { short: 'スノーライン', title: 'スノーライン',
        // (round 14a: from the model, n.snow; the dashed ring went in round 13a, the name stays)
        text: (n) => `スノーラインは約 ${n.snow} au にあります。その外では、赤道面の小石が氷をまといます。すぐ外に小石が少したまり、内側では氷が昇華して岩の粒になります。` },
      planet: { short: '惑星', title: '惑星',
        text: '3 au を回る木星質量の惑星。ガスを押しのけてギャップを開け、自分の小さな円盤を持ちます。奥で明るいのは、星に照らされたギャップの外壁です。' },
      mm: { short: 'ミリ波', title: 'ミリ波で見る',
        text: 'ミリ波(ALMA の波長)では、赤道面の小石が光ります。惑星のギャップは暗い溝に、そのすぐ外にたまった小石は明るい環になります。' },
      heat: { short: '温度', title: '円盤の中の温度',
        text: (n) => `手前の半分を切り取り、切り口を温度で塗りました。白い線(τ* = 1)より上では星の光で塵が熱く、その下の内部は温度が低いまま。約 ${n.rTI} au より内側だけは降着の熱で赤道面が最も熱くなります。` },   // (round 14a: n.rTI from the model)
      deadzone: { short: 'デッドゾーン', title: 'デッドゾーン',
        text: '右手前の 4 分の 1 を切り取り、何が起きている所かで塗り分けました。紺のデッドゾーンでは磁場がガスをつかめず、乱流も起きません。降着はそのすぐ上の薄い層(琥珀色)を流れ、そこで磁力線が折れ曲がります。その上は風の根元です。' },
      star: { short: '星のそば', title: '星のすぐそば',
        text: '星から 0.15 au。星の磁場が円盤を 0.05 au で切り取り、ガスは磁力線に沿う弧状のカーテン(桃色)となって星へ落ちます(秒速約 400 km)。' },
      afar: { short: '遠くから', title: '遠くから',
        text: '340 au から。母体の雲の名残(エンベロープ)が回転しながら円盤へ落ち、軸に沿って開いた空洞の壁が、星の光で明るく見えます。' }
    },
    looks: {
      model: { label: 'モデル', note: '色は物質(円盤、小石、円盤風、エンベロープなど。絵の隅に一覧)、明るさはその量です。温度は断面の「温度」と観測の見え方で見られます。' },
      optical: { label: '可視光', note: '可視光・近赤外線で見た姿。表層と風が散らす星の光(散乱光)が見えます。' },
      mir: { label: '中間赤外', note: '中間赤外線。暖かい表層が自ら光り、内側ほど明るく見えます。' },
      mm: { label: 'ミリ波', note: 'ミリ波。赤道面に沈んだ小石の熱放射です。' },
      // (round 9, the owner: "the CO line had better not name the molecule": a gas's emission line; the link's key stays co)
      co: { label: 'ガス輝線', note: 'ガスが出す輝線(電波で観測される分子の回転輝線)。ドップラー効果で、ガスの動きが色と形に現れます。' }
    },
    pebblesKey: '小石(岩・氷)',
    arrowsKey: 'ガスの流れ(長さは速さの桁)',
    coModes: { chan: 'チャンネル', m1: '平均速度', m0: '積分強度' },
    coNotes: {
      chan: '視線速度がこの値に近いガスだけが光ります。',
      m1: '平均の視線速度(モーメント 1)。赤は遠ざかり、青は近づくガスです。',
      m0: '輝線の強さを速度について足し合わせたもの(モーメント 0)です。'
    },
    velocity: '視線速度',
    // (round 18i) the model look's light under the looks: the starlight, or the gas's own thermal light with its opacity (app.js)
    glow: { name: '光り方', label: 'モデルの見え方の光り方', star: '星の光', self: '自身の発光',
      note: '表層を星の光で照らさず、ガスと塵がその場の温度で自ら光り、同じ不透明度で吸収します。明るさは輝度温度で、厚い所では見る側から光学的深さ 1 の所の温度、薄い所では柱密度と温度の積を表します。',
      k: '不透明度 κ', kOf: '自身の発光の不透明度(ガス 1 g あたり)', kReset: '不透明度を既定に戻す', kDefault: '既定',
      kSpoken: (n) => `ガス 1 グラムあたり ${n.k} 平方センチメートル` },
    cutQ: { T: '温度', rho: '密度', layers: '領域' },
    cutNotes: {
      T: '切り口の色は温度です(対数の尺度、左上の目盛り)。',
      rho: '切り口の色はガスの密度です(1 au の赤道面に対する比、対数の尺度)。',
      layers: '切り口を、何が起きている所か(乱流、デッドゾーン、降着層、風の根元、円盤風)で塗り分けています(色の意味は左上)。'
    },
    // the key of the cut's lines and of what is left clear (round 6: the names are no longer on the face)
    cutKey: {
      tau1: '星の光が届く深さ(τ* = 1)', tau1Regions: '星の光が届く深さ(τ* = 1):ここから上が円盤風',
      ice: 'スノーライン(160 K、氷の境界)',
      pebbles: '小石の層(茶:岩、白:氷)',
      contour: '等密度線(目盛りの値)',
      field: '磁力線', flow: '風の速度(長さは右下の 1, 10, 100 km/s の矢印と比べる)', acc: '降着の流れ(同じ尺度)', planet: '惑星の軌道(点)とヒル半径(輪)',
      clear: {
        T: '色のない所:円盤風と、内縁(0.08 au)より内側。温度を描いていません。',
        rho: '色のない所:軸のまわりと、内縁より内側。このモデルではガスがありません。',
        layers: '色のない所:軸のまわりと、内縁より内側。このモデルではガスがありません。'
      },
      label: '断面の線'
    },
    actions: {
      asym: '上下非対称に(Mori, Bai & Tomida 2025)',
      burst: '星を増光させる',
      waves: '惑星の波を強調',
      noplanet: '惑星を消す'
    },
    back: 'この眺めに戻る',
    onward: '次へ:', again: 'はじめから:',
    count: (i, n) => `${i} / ${n}`,
    prev: '前の場所', next: '次の場所',
    play: '再生', pause: '一時停止',
    clockRate: (n) => `今は ×1/${n}。`,
    hintMouse: 'ドラッグで回転 · スクロールで拡大',
    hintTouch: '1 本指で回転 · 2 本指で拡大と回転',   // (round 18e: one finger turns, as a drag does)
    loading: '準備しています…',
    reduced: '動きを減らす設定のため、時計を止めています。',
    linkCopied: 'リンクをコピーしました。',
    linkShown: 'リンクを表示しました。選んでコピーしてください。',
    imageBusy: '画像を作っています…',
    imageProgress: (i, n) => `画像を作っています… ${i} / ${n}`,
    imageDone: '画像を保存しました。',
    // (round 7) the saved picture's size: as the screen, twice, or 3840 px wide (4K); the lines, labels and the mark at that size
    saveSize: {
      label: '保存する画像の大きさ', screen: '画面と同じ', twice: '2 倍', uhd: '4K',
      note: (w, h) => `保存する画像:${w} × ${h} px(線と文字と印もその大きさに合わせて)。`,
      lower: (w, h, pct) => `保存する画像:${w} × ${h} px。この見え方は重いため、ガスは ${pct} % の細かさで描きます。`,
      coScreen: (w, h) => `この見え方は計算が重いため、画面と同じ ${w} × ${h} px で保存します。`
    },
    // (round 11c) the saved picture's shape (cut from the middle of the view, never stretched) and the credit in its corner
    saveFrame: {
      label: '保存する画像の縦横比', screen: '画面のまま', '16:9': '16:9', '4:3': '4:3', credit: '隅に出典',
      crop: '眺めの中央から切り出します(引き伸ばしません)。縮尺の帯は隅に移します。'
    },
    // (round 11c) the QR code for the audience: "QR code" beside "Copy a link", and Q in the presenter (app.js, qrShow)
    qr: {
      label: 'リンクの QR コード',
      view: '携帯のカメラで読み取ると、この眺めが開きます。',
      scenes: (n) => `携帯のカメラで読み取ると、この ${n} 場面が開きます。`,
      tooLong: (place) => `リンクが長く、離れた携帯で読める QR コードに収まらないため、「${place}」を開くコードにしました(場面や眺めは入りません)。`,
      failed: 'QR コードを作れませんでした。'
    },
    imageFailed: '画像を作れませんでした。',
    still: {
      nogl: 'このブラウザーでは動くモデルを描けないため(WebGL 2 が必要です)、同じモデルの静止画を表示しています。',
      software: 'この端末の WebGL はソフトウェアで描いていて、動くモデルには遅すぎます。同じモデルの静止画を表示しています。',
      slow: 'この端末では描画が遅すぎるため、同じモデルの静止画を表示しています。',
      failed: '動くモデルを始められなかったため、同じモデルの静止画を表示しています。',
      forced: '静止画を表示しています。',
      lost: '描画が中断しました。戻るまで静止画を表示します。',
      // (round 9) what helps when the browser's WebGL has stopped: quitting and reopening the browser; the way to quit it
      blocked: (how) => `このブラウザーの WebGL が止まっています。${how}。動くモデルに戻ります(再読み込みやキャッシュの消去では戻りません)。`,
      stuck: (how) => `描画が止まりました。${how}。再読み込みやキャッシュの消去では戻りません。`,
      restart: {
        ios: (app) => `App スイッチャー(画面の下端から上へスワイプして指を止める)で ${app} を上へはじいて閉じ、開き直してください`,
        mac: (app) => `${app} を終了(⌘Q)して開き直してください`,
        other: () => 'ブラウザーを一度終了して開き直してください'
      },
      tryLive: 'それでも動かす',
      retryText: '描画が止まったままです。',
      retryHint: 'ボタンで描き直します。それでも戻らないときは、ブラウザーを一度終了して開き直してください(キャッシュを消す必要はありません)。',
      retry: 'もう一度描く'
    },
    resetDone: '最初の状態に戻しました。',
    preparingLook: 'この見え方を準備しています…',
    heavyStill: 'この見え方はこの端末で動かすには重いため、時計を止めて描いています(再生ボタンで動かすこともできます)。',
    safeStart: '前回は描画が止まったため、安全な設定(モデルの見え方、断面なし、画質は自動、全体の眺め)で始めました。',
    restoredSafe: '描画が中断したため、モデルの見え方に戻しました。',
    // (round 10a) the safe start that leaves out only what was in view when drawing stopped, and offers the settings back;
    // the flight record (kept on this device, nothing sent)
    safeStartKnown: (what) => `前回は${what}の表示中に描画が止まったため、その表示を避けて始めました(画質は自動)。`,
    safeRestore: '前の設定に戻す',
    restoredKept: '前の設定に戻しました。',
    cutName: '断面',
    log: {
      show: '前回の記録を見る', title: '前回の記録', mine: 'この訪問の記録',
      note: 'この端末にだけ残した記録です。どこにも送っていません。不具合を知らせるときに貼り付けてください。',
      copy: 'コピー', copied: 'コピーしました', close: '閉じる', none: '記録はありません。'
    },
    ariaStage: '円盤のモデル',
    ariaRoute: '見どころ',
    show: {
      gas: 'ガス', pebbles: '小石', wind: '円盤風', jet: 'ジェット', field: '磁力線', planet: '惑星', envelope: 'エンベロープ', labels: '注釈',
      asym: '上下非対称(Mori, Bai & Tomida 2025)', marks: '流れの矢印', waves: '波を強調',
      planetRow: (i, a) => `${i}  ${a} au`, orbit: (i) => `惑星 ${i} の軌道半径`, massOf: (i) => `惑星 ${i} の質量`, remove: '外す',
      addPlanet: '惑星を置く', picking: '円盤をクリックした半径に惑星を置きます(Esc でやめる)。',
      drop: 'タップで小石を置く', dropping: '円盤をタップ(クリック)すると、そこに小石の塊を置きます。同じ半径に 3 つ続けて置くと、惑星が育ちます(Esc でやめる)。', placed: (a) => `${a} au に惑星を置きました。`,
      noRoom: 'そこには置けません(0.05〜20 au、隣の惑星から相互ヒル半径の 4 倍以上)。', full: '惑星は 4 つまでです。',
      // (round 13a) the model look's colours beside the components (app.js, COMPS' cols). (Round 18d) In each component's palette,
      // which its swatch opens: the swatch's and the palette's name (pal; palOp in the other looks, the see-through alone), a colour's
      // name on its row (colName), and a chip for each colour (colReset, by the colour's key)
      pal: (name) => `${name}の色と透過`, palOp: (name) => `${name}の透過`,
      colOf: (k) => 'モデルの見え方での' + (COLS_JA[k] || k) + 'の色', colName: (k) => ({ rock: '岩', ice: '氷' }[k] || '色'),
      colDefault: '既定の色', colReset: (k) => `${COLS_JA[k] || k}の色を既定に戻す`,
      // (round 13e) the planets' accretion rate, which sets their own disks (app.js, the planets' panel)
      cpdMdot: '惑星への降着率', cpdMdotOf: 'すべての惑星への降着率(対数)', cpdAuto: (v) => `自動(円盤の降着率の 1/10:${v})`, cpdAutoBtn: '自動に戻す',
      cpdNote: '惑星のまわりの円盤(周惑星円盤)の温度・厚さ・ミリ波での明るさは、この降着率と惑星の質量から決まります。軽い惑星や外側の惑星(熱的質量が小さい)では、円盤でなく丸い包みになります。',
      // (round 14a) the wind's brightness in the model look, under the wind's settings (app.js, wbEls)
      windGain: '明るさ', windGainOf: 'モデルの見え方での円盤風の明るさ', windGainReset: '円盤風の明るさを既定に戻す', gainDefault: '既定',
      // (round 18a) each component's see-through, under its settings (app.js, opEls): the share of its extinction taken away
      // (round 18d: in its palette, opac the row's name; the jet's, which has no extinction and only shines, dims its light, and the
      // field lines' draws their lines fainter: opacOf by the component's key, opacJet the note in the jet's palette)
      opac: '透過', opacOf: (name, k) => `${name}の透過(${k === 'jet' ? '光を弱める割合' : k === 'field' ? '線を薄く描く割合' : '光をさえぎる強さを弱める割合'})`, opacReset: (name) => `${name}の透過を既定(0 %)に戻す`, opacVal: (p) => `${p} %`,
      opacJet: 'ジェットは光るだけなので、透過は明るさを下げます。',
      planetsNote: '軌道半径 0.05〜20 au(内側の端は、星の磁場が円盤を切り取る所)、質量は地球の 10 倍から木星の 3 倍(重いほどギャップが深く広く、小石の環は孤立質量を超えるとできます)。隣どうしは相互ヒル半径の 4 倍以上離します(近すぎる軌道は不安定です)。絵の中の惑星をクリックしても動かせます。'
    },
    // (round 14a) the model's parameters, the rail's Model (app.js; the engine's box.diskParams)
    model: {
      note: '物理の値を変えると、温度、電離、円盤風が式に従って変わります。既定は文献に合わせた値です。変えた値は端末に残り、リンクにも入ります。',
      groups: { star: '星', heat: '降着と温度', wind: '円盤風', planets: '惑星' },
      names: { lum: '光度 L*', tstar: '色温度 T*', mdot: '降着率 Ṁ', alphaIn: '乱流の強さ α(熱電離した内側円盤)', tTI: '熱電離の温度',
        lamIn: 'レバーアーム λ(塵の内縁 0.08 au)', lamTI: 'レバーアーム λ(熱電離の縁)', lamOut: 'レバーアーム λ(外側、30 au)', chic: '風の根元 χ_c(r₀ を単位に)', alphaGap: 'ギャップの粘性 α' },
      def: '既定', reset: (name) => `${name}を既定に戻す`,
      heat: (d) => `熱電離の縁 ${d.rTI} au、スノーライン ${d.snow} au(増光すると ${d.burst} au)、1 au の赤道面 ${d.t1} K。デッドゾーンと外側円盤の α は内側との比のまま動きます。`,
      wind: (d) => `星へ届く降着 ${d.star} M☉/年(Ṁ の ${d.fStar} %)。30 au を内へ通る流れのうち、${d.share} % を風が運び去ります。`,
      windOff: '前の処方(?mflux=0)の間は、ここの値は風に効きません。',
      lamOld: '?lam=old の間は、λ の値は効きません(第 8 巡の λ)。',
      planets: '惑星の数、軌道、質量は「見せるもの」の惑星で変えられます。'
    },
    quality: {
      label: '画質', auto: '自動', low: '低', mid: '中', high: '高', full: '最高',
      autoNote: '自動:端末の速さに合わせて解像度を変え、動きが止まると細かく描き直します。',
      fixedNote: (pct) => `固定:画面の解像度の ${pct} % で描きます(自動の調整は止まります)。`,
      capped: (pct) => `この眺めでは重すぎるため、${pct} % に下げています(描画が止まらないように)。`,
      bestNote: '最高(既定):画面の解像度で描きます。重い眺めでは、動きが滞らないよう、自動で一段ずつ下げます。',
      bestCapped: (pct) => `最高(既定):この眺めは重いため、いまは ${pct} % で描いています。`
    },
    // (round 11a) moves and talks: the built-in moves, the pace, the scenes and the presenter (app.js)
    talk: {
      moves: { orbit: 'ぐるりと 1 周', rise: '真横から真上へ', powers: '遠くから星まで', planet: '円盤に沿って惑星へ', timelapse: '時間を早送り', looks: '見え方を順に' },
      pace: { label: '動きの速さ', slow: 'ゆっくり', normal: 'ふつう', fast: '速く' },
      viewN: (n) => `眺め ${n}`,
      nameOf: (n) => `場面 ${n} の名前`, up: (n) => `場面 ${n} を上へ`, down: (n) => `場面 ${n} を下へ`, remove: (n) => `場面 ${n} を外す`,
      go: '行く', goTo: (n) => `場面 ${n} へ行く`,
      play: '再生', stop: '止める', clear: 'すべて外す', clearAgain: 'もう一度押すと外します',
      full: (n) => `場面は ${n} までです。`,
      linkCopied: '場面の並びのリンクをコピーしました。',
      linkFailed: 'このリンクの場面の並びは読めませんでした。',
      fromLink: (n) => `リンクから ${n} 場面を開きました(「動きと発表」)。`,
      loaded: (n) => `${n} 場面を開きました。`,
      restored: '前の場面に戻しました。',
      loadFailed: 'Disk Lab の場面の並びのファイルではありません。',
      presentHint: '→ で次の場面へ · Esc で終わり',
      last: '最後の場面です。'
    },
    // (round 11b) the video (app.js, exportVideo)
    video: {
      scenes: (n) => `場面(${n})`, places: '見どころの 9 か所',
      hold: (s) => `${s} 秒`,
      about: (s) => (s < 90 ? `約 ${Math.max(1, Math.round(s))} 秒` : s < 5400 ? `約 ${Math.round(s / 60)} 分` : `約 ${Math.floor(s / 3600)} 時間 ${Math.round((s % 3600) / 60)} 分`),
      plan: (p) => `${p.seconds} 秒、${p.frames} コマ(${p.w} × ${p.h}、毎秒 ${p.fps} コマ)。画質は${p.level}(1 コマに ${p.sub} 枚を平均${p.capped ? `。ガス輝線の見え方があるので ${p.capped} %` : ''})、背景は黒。約 ${p.mb} MB。このコンピューターで${p.time}(見積もり。作りながら測ります)。`,
      long: (n, max, min) => `1 本の動画には長すぎます:${n} コマ(${max} コマ、毎秒 30 コマで ${min} 分まで)。場面を減らすか、止まる時間を短くしてください。`,
      big: (gb, max) => `メモリーに収まりません:約 ${gb} GB(${max} GB まで)。小さい大きさか、毎秒 30 コマにしてください。`,
      codec: (w, h, fps) => `このブラウザーは ${w} × ${h}・毎秒 ${fps} コマの H.264 を作れません。小さい大きさか、毎秒 30 コマを選んでください。`,
      gpu: (w, h) => `この GPU は ${w} × ${h} の絵を描けません。小さい大きさを選んでください。`,
      noEncoder: 'このブラウザーでは動画を作れません(WebCodecs の H.264 のエンコーダーがありません)。コンピューターの Chrome か Edge、または Safari 16.4 以降で作れます。',
      noMotion: '動きを減らす設定(システムの設定)では動画を作れません。動画を形づくる飛行とフェードが、その設定では切られるためです。',
      preparing: '最初のコマを準備しています…',
      progress: (i, n, j, m, per, left) => `動画を作っています:${n} コマ中 ${i} コマ目${m > 1 ? `(${m} 枚中 ${j} 枚目)` : ''}${per ? `・1 コマ ${per} 秒・残り${left}` : ''}`,
      writing: 'ファイルにまとめています…',
      cancelling: 'やめています…',
      done: (name, mb) => `動画を保存しました:${name}(${mb} MB)。`,
      cancelled: '動画づくりをやめました。元の眺めに戻しました。',
      failed: (why) => `動画を作れませんでした(${why})。元の眺めに戻しました。`,
      lost: 'GPU のコンテキストが失われました',
      slow: '可視光と中間赤外線の見え方は、この画質では 1 コマに数十秒かかることがあります(最高・1080p の見積もりで約 17 秒。まだ測れていません)。画質を「中」にすると何倍も速くなります。',
      credit: (y, url) => CREDIT_LINE(y, url)
    },
    // (round 12a) the probe: a tap on the picture reads the model at the midplane point under it (app.js, probeAt; the
    // engine's box.diskProbe). physics: one sentence per region (the regions' face's, see layersFace in the engine)
    probe: {
      on: '絵の円盤をタップ(クリック)すると、その場所の赤道面の物理量を示します。惑星をタップするとその惑星を、円盤の上や下なら視線が星に最も近づく所を調べます(もう一度タップで移す、Esc でやめる)。',
      title: (r) => `探針:R = ${r} au の赤道面`, close: '探針を外す',
      T: '温度', rho: 'ガスの密度', sigma: '面密度', H: 'スケールハイト', vK: 'ケプラー速度', P: '公転周期', alpha: '乱流の強さ α', region: '領域', water: '水',
      laminar: 'なし(層流)', none: '—(円盤のガスはない)', days: '日', yr: '年',
      regions: { inner: '熱で電離した内側の円盤', dead: 'デッドゾーン', acc: '降着層', base: '風の根元', wind: '円盤風', outer: '弱い乱流の外側円盤', hall: 'ホール効果の層', cavity: '磁気圏の空洞', jet: 'ジェット', envelope: 'エンベロープ' },
      physics: {
        inner: (n) => `${n.tTI} K を超えてアルカリ金属が電離し、磁場がガスと結びつきます。磁気回転不安定で強く乱れ(α ≈ ${n.aIn})、降着の熱で円盤が自らを温めています。`,
        dead: '電離が弱く、オーム散逸で磁場がガスと結びつかないため、乱流のない静かな層です(磁気回転不安定が働かない)。降着は上の降着層が担い、小石は赤道面に沈んで内側へ流れていきます。',
        acc: '磁場が曲がり電流が流れる層です。円盤風に角運動量を奪われたガスが、薄い層流となって星へ流れ込みます(ジュール加熱の場所)。デッドゾーンの外では赤道面にあります。',
        base: '磁場が開き、ガスがゆっくり持ち上げられて円盤風になる手前の層です(両極性拡散が効き、乱流はありません)。',
        wind: '星の紫外線で電離したガスが、磁力線に沿って吹き出しています。円盤風は角運動量を運び去り、円盤の降着を駆動します。',
        outer: (n) => `宇宙線が赤道面まで届き磁場は結びつきますが、両極性拡散のため乱流は弱いままです(α ≈ ${n.aOut})。`,
        hall: '磁場が回転と同じ向きのとき、ホール効果で電流の層が片側へ押しやられ、その下で磁場が一方向に巻かれています。',
        cavity: '星の磁場がガス円盤を切り取った内側です。ガスは磁力線に沿って星へ落ちていきます。',
        jet: '星のそばから軸に沿って細く速く吹き出すジェットです。',
        envelope: '母体の雲の名残です。円盤を包み、星と円盤へ落ちてきます。'
      },
      snowIn: (r) => `蒸気(スノーライン ${r} au の内側)`, snowOut: (r) => `氷(スノーライン ${r} au の外側)`, snowOutWarm: (r) => `蒸気(スノーライン ${r} au の外側だが、ここは 160 K より暖かい)`,
      gap: (o) => `${o.a} au の惑星のギャップの中:ガスは周りの ${o.f} %(ギャップは軌道で深さ ${o.depth} %、半分の深さでの幅 ${o.w} au:Kanagawa et al. 2016)${o.bump ? `。圧力の山(小石が集まる所)は ${o.bump} au` : ''}`, trap: (a) => `${a} au の惑星の外側の圧力の山:小石が集まります`,
      // (round 15a) a planet's point; the magnetosphere; above the disk (the wind, the jet, the envelope)
      planetTitle: (a) => `探針:${a} au の惑星`, mass: '質量', hill: 'ヒル半径', qth: '熱的質量(q / h³)',
      gapOf: (o) => `ギャップ(Kanagawa et al. 2016、α = ${o.alpha}、K = ${o.K}):軌道で深さ ${o.depth} %、半分の深さでの幅 ${o.w} au。`,
      bump: (r) => `圧力の山(小石が集まる所):${r} au。`, noGap: '軽すぎて、このモデルではギャップが開きません。',
      cpdOf: (o) => `${o.kind === 'disk' ? '自前の周惑星円盤' : 'まわりの包み'}:半径 ${o.rOut} au(${o.rOutH} R_H)まで、半分の所で約 ${o.T} K、降着率 ${o.mdot}(${o.auto ? '自動:円盤の降着率の 1/10' : '設定した値'})。`,
      aboveTitle: (o) => `探針:円盤の${o.below ? '下' : '上'}、視線が星に最も近づく所 r = ${o.r} au(R = ${o.R} au、|z| = ${o.z} au)`,
      rT: '切断半径 r_T', curtains: '降着のカーテン', vff: 'r_T からの自由落下', rCo: '共回転半径',
      curtainsV: (a, b) => `${a}〜${b} au で円盤を離れる磁力線に沿って、星の極から約 25° の所へ`,
      vffV: (here, star) => `ここで ${here} km/s、星の表面で ${star} km/s`, rCoV: (r, d) => `${r} au(星の自転周期 ${d} 日)`,
      windRho: 'ガスの密度(円盤風)', windV: '磁力線に沿った速さ', windRot: '回転の速さ', windFoot: '吹き出した所', windTerm: '終端速度',
      windFootV: (r, lam, bud) => `R = ${r} au、レバーアーム λ ${lam}${bud ? `(質量の勘定では ${bud})` : ''}`,
      jetV: '速さ', envV: '落ちる速さ', noScale: '示しません(モデルに物理的な目盛りがありません)',
      hidden: '今は表示していません(「見せるもの」でオンに)。', inCavity: '軸に沿った流出の空洞の中で、エンベロープのガスは払われています。', beyondEnv: 'モデルが描くエンベロープ(560 au)の外です。',
      // (round 13e) inside a planet's own disk (or envelope)
      cpd: (o) => `${o.a} au の惑星(${o.m})の${o.kind === 'disk' ? '周惑星円盤' : 'まわりの包み'}の中:惑星から ${o.r}(${o.rH} R_H、外縁は ${o.rOut} R_H)、${o.T} K、H/r ${o.Hr}、降着率 ${o.mdot}`,
      model: (n) => `モデルの値です。見やすさのため円盤は温度から決まる厚みの ${n.hf} 倍に描き、面密度は 1 au で 1700 g/cm² としています。`   // (round 14a: n from the model's parameters)
    },
    // (round 8, the owner: "the citation in English in Japanese too": the lead stays Japanese, the line is the English one)
    cite: {
      lead: '研究、発表、授業、資料に自由に使ってください。出典の明記は要りません。引用するなら、この一行をどうぞ。',
      line: (y, url, v) => CITE_LINE(y, url, v),
      copy: '引用をコピー', copied: '引用をコピーしました。'
    },
    // (round 12b) looking in by tilting the phone: the switch in View and what it says (app.js, tiltSay; both languages are
    // written at once, as spans that the page's language shows)
    tilt: {
      label: '傾けて覗き込む',
      off: '携帯を傾けると、円盤を手に持ったように眺めが少し(6° まで)回ります。リンクや端末に残す設定には入りません。',
      on: 'オン:携帯を傾けると覗き込めます。動き・再生・発表の間とドラッグの間は止まります。',
      asking: '動きのセンサーを使ってよいか、ブラウザーに確かめています…',
      denied: 'センサーの使用が許可されなかったので、オフのままです。使うには、ブラウザーの設定で「モーションと画面の向きへのアクセス」を許可してから、もう一度オンにしてください。',
      failed: 'センサーを使えなかったので、オフのままです。',
      none: 'この端末からは傾きが届かないので、オフにしました。',
      touch: 'オン:画面に一度触れると、傾きのセンサーが始まります(ブラウザーが確かめることがあります)。',
      reduced: '動きを減らす設定の間は使えません。'
    },
    // (round 18a) the rail's View and Background: the camera's roll about the line of sight and the number of the background's stars
    // (app.js, renderRoll and renderStars)
    view: {
      roll: '回転', rollOf: '視線を軸にした眺めの回転', rollReset: '回転を 0° に戻す', rollVal: (d) => `${d}°`,
      stars: '星の数', starsOf: '背景の星の数(既定の何倍か)', starsReset: '星の数を既定に戻す', starsVal: (k) => `× ${k}`,
      // (round 18e) the point looked at, under the roll: its name, its arrows (app.js, renderAim) and its chip back to the star, or
      // to the planet while one is followed
      aim: '注視点', aimLeft: '注視点を左へ', aimUp: '注視点を上へ', aimDown: '注視点を下へ', aimRight: '注視点を右へ',
      aimStar: '星に戻す', aimStarOf: '注視点を星に戻す', aimPlanet: '惑星に戻す', aimPlanetOf: '注視点を惑星に戻す'
    }
  },
  en: {
    places: {
      whole: { short: 'Whole disk', title: 'The whole disk',
        text: 'A disk of gas and dust around a young star, some 30 au in radius: the kind of disk in which planets form. Starlight warms its flared surface; the midplane stays cold. The lines threading it are magnetic field lines, and the faint glow above is a wind. It starts with a Jupiter-mass planet at 10 au and the clock stopped (the play button under Time starts it).' },
      wind: { short: 'Field & wind', title: 'Field and wind',
        text: 'Field lines threading the disk are wound up by its rotation and open outward. Gas speeds up along them and leaves both faces as a wind; with the field aligned with the rotation, one side blows harder.' },
      snow: { short: 'Snow line', title: 'The snow line',
        text: (n) => `The snow line lies near ${n.snow} au: beyond it, the pebbles at the midplane are coated in ice. They pile up a little just outside it; inside, the ice sublimates and the grains are bare rock.` },   // (round 14a: from the model; the ring went in round 13a)
      planet: { short: 'Planet', title: 'The planet',
        text: 'A Jupiter-mass planet at 3 au pushes the gas aside into a gap and keeps a small disk of its own. Behind it, starlight catches the outer wall of the gap.' },
      mm: { short: 'Millimetre', title: 'In millimetre light',
        text: 'At millimetre wavelengths (ALMA\u2019s) the pebbles at the midplane glow. The planet\u2019s gap shows as a dark lane; the pebbles trapped just outside it form a bright ring.' },
      heat: { short: 'Heat', title: 'Heat inside the disk',
        text: (n) => `The near half is cut away through the star and the cut face coloured by temperature. Above the white line (\u03c4* = 1) starlight makes the dust hot; the interior below stays cool. Only inside about ${n.rTI} au does accretion make the midplane the hottest.` },   // (round 14a: n.rTI from the model)
      deadzone: { short: 'Dead zone', title: 'The dead zone',
        text: 'The near right quarter is cut away and coloured by what happens there. In the navy dead zone the field cannot grip the gas, and nothing stirs; accretion runs in a thin layer just above it (amber), where the field lines bend, and above that the wind is launched.' },
      star: { short: 'The star', title: 'Next to the star',
        text: 'From 0.15 au: the star\u2019s magnetic field holds the disk off at 0.05 au, and gas falls onto the star along the field lines in arc-shaped curtains (pink), at about 400 km/s.' },
      afar: { short: 'Afar', title: 'From afar',
        text: 'From 340 au: the remains of the parent cloud (the envelope) fall onto the disk as they rotate, and starlight lights the walls of a cavity along the axis.' }
    },
    looks: {
      model: { label: 'Model', note: 'Colour is the material (the disk, pebbles, wind, envelope and so on; the key in a corner of the picture), brightness how much of it is there. Temperature shows on the cut and in the observed looks.' },
      optical: { label: 'Visible', note: 'Visible and near-infrared light: starlight scattered by the surface and the wind.' },
      mir: { label: 'Mid-IR', note: 'Mid-infrared: the warm surface glows, brightest close in.' },
      mm: { label: 'Millimetre', note: 'Millimetre: the thermal glow of the pebbles at the midplane.' },
      co: { label: 'Gas line', note: 'An emission line of the gas (a molecule\u2019s rotational line, observed at radio wavelengths): its Doppler shift shows how the gas moves.' }
    },
    pebblesKey: 'pebbles (rock, ice)',
    arrowsKey: 'gas flow (length: speed, by powers of ten)',
    coModes: { chan: 'Channel', m1: 'Velocity', m0: 'Intensity' },
    coNotes: {
      chan: 'Only gas moving near this line-of-sight velocity shines.',
      m1: 'Mean line-of-sight velocity (moment 1): red recedes, blue approaches.',
      m0: 'The line’s strength summed over velocity (moment 0).'
    },
    velocity: 'Velocity',
    glow: { name: 'Light', label: 'Light of the model look', star: 'Starlight', self: 'Own emission',
      note: 'No surface lit by the star: the gas and its dust glow at their own temperature and absorb at the same opacity. Brightness is the brightness temperature: where thick, the temperature at optical depth 1 seen from the camera; where thin, the column density times the temperature.',
      k: 'Opacity κ', kOf: 'Opacity of the own emission, per gram of gas', kReset: 'Opacity: back to the default', kDefault: 'Default',
      kSpoken: (n) => `${n.k} square centimetres per gram` },
    cutQ: { T: 'Temperature', rho: 'Density', layers: 'Regions' },
    cutNotes: {
      T: 'The cut face shows temperature (logarithmic; the scale at the top left).',
      rho: 'The cut face shows gas density, relative to the midplane at 1 au (logarithmic).',
      layers: 'The cut face is divided by what happens there: turbulence, the dead zone, the accretion layer, the wind base, the wind (the key at the top left).'
    },
    cutKey: {
      tau1: 'Where starlight reaches (\u03c4* = 1)', tau1Regions: 'Where starlight reaches (\u03c4* = 1): above it, the wind',
      ice: 'Snow line (160 K, where water freezes)',
      pebbles: 'Pebbles (brown: rock, white: ice)',
      contour: 'Density contours (at the scale\u2019s ticks)',
      field: 'Field lines', flow: 'Wind velocity (compare the arrows of 1, 10, 100 km/s at the lower right)', acc: 'Accretion flow (the same scale)', planet: 'Planet orbit (dot) and Hill radius (ring)',
      clear: {
        T: 'No colour: the wind, and inside the inner edge (0.08 au); no temperature is drawn there.',
        rho: 'No colour: along the axis, and inside the inner edge; this model has no gas there.',
        layers: 'No colour: along the axis, and inside the inner edge; this model has no gas there.'
      },
      label: 'Lines on the cut'
    },
    actions: {
      asym: 'One-sided (Mori, Bai & Tomida 2025)',
      burst: 'Make the star flare',
      waves: 'Exaggerate the waves',
      noplanet: 'Remove the planet'
    },
    back: 'Back to this view',
    onward: 'Next: ', again: 'From the start: ',
    count: (i, n) => `${i} / ${n}`,
    prev: 'Previous place', next: 'Next place',
    play: 'Play', pause: 'Pause',
    clockRate: (n) => ` Now ×1/${n}.`,
    hintMouse: 'Drag to turn · scroll to zoom',
    hintTouch: 'One finger turns · two zoom and turn',
    loading: 'Preparing…',
    reduced: 'Reduced motion is on, so the clock is stopped.',
    linkCopied: 'Link copied.',
    linkShown: 'The link is shown below; select it to copy.',
    imageBusy: 'Making the image…',
    imageProgress: (i, n) => `Making the image… ${i} / ${n}`,
    imageDone: 'Image saved.',
    saveSize: {
      label: 'Size of the saved image', screen: 'Screen', twice: '2×', uhd: '4K',
      note: (w, h) => `The image: ${w} × ${h} px (lines, labels and the mark at that size too).`,
      lower: (w, h, pct) => `The image: ${w} × ${h} px. This look is heavy, so the gas is drawn at ${pct} % detail.`,
      coScreen: (w, h) => `This look is heavy to compute, so it is saved at the screen’s size, ${w} × ${h} px.`
    },
    saveFrame: {
      label: 'Shape of the saved image', screen: 'As the screen', '16:9': '16:9', '4:3': '4:3', credit: 'Credit in the corner',
      crop: ' Cut from the middle of the view, not stretched; the scale bar moves into the corner.'
    },
    qr: {
      label: 'QR code of the link',
      view: 'Scan it with a phone’s camera to open this view.',
      scenes: (n) => `Scan it with a phone’s camera to open these ${n} scenes.`,
      tooLong: (place) => `The link is too long for a code that phones can read from afar, so this code opens “${place}” only (not the scenes or the view).`,
      failed: 'The QR code could not be made.'
    },
    imageFailed: 'The image could not be made.',
    still: {
      nogl: 'This browser can’t draw the live model (it needs WebGL 2), so these are still pictures of the same model.',
      software: 'WebGL here runs in software, too slow for the live model, so these are still pictures of the same model.',
      slow: 'This device draws the model too slowly, so these are still pictures of the same model.',
      failed: 'The live model could not start, so these are still pictures of the same model.',
      forced: 'Showing still pictures.',
      lost: 'Drawing was interrupted; a still picture shows until it recovers.',
      blocked: (how) => `WebGL has stopped in this browser. To bring the live model back, ${how} (reloading the page or clearing the cache does not help).`,
      stuck: (how) => `Drawing has stopped. To bring it back, ${how}; reloading the page or clearing the cache does not help.`,
      restart: {
        ios: (app) => `close ${app} from the app switcher (swipe up from the bottom edge and pause, then flick ${app} up) and open it again`,
        mac: (app) => `quit ${app} (⌘Q) and open it again`,
        other: () => 'quit the browser and open it again'
      },
      tryLive: 'Run the live model anyway',
      retryText: 'Drawing has stopped.',
      retryHint: 'The button draws it again; if that does not help, quit the browser and open it again (clearing the cache is not needed).',
      retry: 'Try again'
    },
    resetDone: 'Everything is back as it was at first.',
    preparingLook: 'Preparing this look…',
    heavyStill: 'This look is too heavy to animate on this device, so the clock is stopped and the picture held still (the play button animates it anyway).',
    safeStart: 'Drawing stopped last time, so this visit starts with safe settings (the model look, no cut, Auto quality, the whole disk).',
    restoredSafe: 'Drawing was interrupted, so the model look is back.',
    safeStartKnown: (what) => `Drawing stopped last time while showing ${what}, so this visit starts without it (Auto quality).`,
    safeRestore: 'Restore my settings',
    restoredKept: 'Your settings are back.',
    cutName: 'the cut',
    log: {
      show: 'Show the last visit’s record', title: 'The last visit’s record', mine: 'This visit’s record',
      note: 'Kept on this device only; nothing has been sent. Paste it into a report of the problem.',
      copy: 'Copy', copied: 'Copied', close: 'Close', none: 'No record.'
    },
    ariaStage: 'Model of a protoplanetary disk',
    ariaRoute: 'Highlights',
    show: {
      gas: 'Gas', pebbles: 'Pebbles', wind: 'Wind', jet: 'Jet', field: 'Field lines', planet: 'Planets', envelope: 'Envelope', labels: 'Labels',
      asym: 'One-sided (Mori, Bai & Tomida 2025)', marks: 'Flow arrows', waves: 'Exaggerate the waves',
      planetRow: (i, a) => `${i}  ${a} au`, orbit: (i) => `Planet ${i}: orbital radius`, massOf: (i) => `Planet ${i}: mass`, remove: 'Remove',
      addPlanet: 'Place a planet', picking: 'Click the disk where the planet should orbit (Esc to stop).',
      drop: 'Tap to drop pebbles', dropping: 'Tap (or click) the disk to drop a clump of pebbles there; three in a row near one radius grow a planet (Esc to stop).', placed: (a) => `A planet placed at ${a} au.`,
      noRoom: 'No room there (0.05 to 20 au, and at least four mutual Hill radii from a neighbour).', full: 'Four planets at most.',
      // (round 13a) the model look's colours beside the components (app.js, COMPS' cols). (Round 18d) In each component's palette,
      // which its swatch opens: the swatch's and the palette's name (pal; palOp in the other looks, the see-through alone), a colour's
      // name on its row (colName), and a chip for each colour (colReset, by the colour's key)
      pal: (name) => `${name}: colour and see-through`, palOp: (name) => `${name}: see-through`,
      colOf: (k) => 'Colour of the ' + String(COLS_EN[k] || k).toLowerCase() + ' in the model look', colName: (k) => ({ rock: 'Rock', ice: 'Ice' }[k] || 'Colour'),
      colDefault: 'Default colour', colReset: (k) => `${COLS_EN[k] || k}: back to the default colour`,
      // (round 13e) the planets' accretion rate, which sets their own disks (app.js, the planets' panel)
      cpdMdot: 'Accretion onto the planets', cpdMdotOf: 'The planets’ accretion rate (all of them, log scale)', cpdAuto: (v) => `Auto (a tenth of the disk’s accretion rate: ${v})`, cpdAutoBtn: 'Back to auto',
      cpdNote: 'The temperature, thickness and millimetre brightness of each planet’s own disk (its circumplanetary disk) follow from this rate and the planet’s mass; a light or distant planet (of few thermal masses) wears a round envelope rather than a disk.',
      // (round 14a) the wind's brightness in the model look, under the wind's settings (app.js, wbEls)
      windGain: 'Brightness', windGainOf: 'Brightness of the wind in the model look', windGainReset: 'Wind: back to the default brightness', gainDefault: 'Default',
      // (round 18a) each component's see-through, under its settings (app.js, opEls): the share of its extinction taken away
      // (round 18d: in its palette, opac the row's name; the jet's, which has no extinction and only shines, dims its light, and the
      // field lines' draws their lines fainter: opacOf by the component's key, opacJet the note in the jet's palette)
      opac: 'See-through', opacOf: (name, k) => `See-through of the ${name.toLowerCase()} (${k === 'jet' ? 'how much dimmer it shines' : k === 'field' ? 'how much fainter the lines are drawn' : 'how much less light it blocks'})`, opacReset: (name) => `${name}: back to no see-through`, opacVal: (p) => `${p} %`,
      opacJet: 'The jet only shines, so its see-through lowers its brightness.',
      planetsNote: 'Orbits of 0.05 to 20 au (the inner end is where the star\u2019s magnetic field cuts off the disk); masses of 10 Earths to 3 Jupiters (heavier planets open deeper, wider gaps, and those above the pebble isolation mass ring their gaps with pebbles). Neighbours are kept at least four mutual Hill radii apart (closer orbits are unstable). A planet in the picture can be clicked to move it too.'
    },
    // (round 14a) the model's parameters, the rail's Model (app.js; the engine's box.diskParams)
    model: {
      note: 'Change a physical value and the temperature, the ionization and the wind follow by the model\u2019s equations. The defaults are the values from the papers it follows. What you change is kept on this device and goes into links.',
      groups: { star: 'The star', heat: 'Accretion and heat', wind: 'The wind', planets: 'Planets' },
      names: { lum: 'Luminosity L*', tstar: 'Colour temperature T*', mdot: 'Accretion rate Ṁ', alphaIn: 'Turbulence α (the thermally ionized inner disk)', tTI: 'Thermal ionization temperature',
        lamIn: 'Lever arm λ (the dust\u2019s inner edge, 0.08 au)', lamTI: 'Lever arm λ (the thermal ionization edge)', lamOut: 'Lever arm λ (the outer disk, 30 au)', chic: 'Wind base χ_c (in units of r₀)', alphaGap: 'Gap viscosity α' },
      def: 'Default', reset: (name) => `${name}: back to the default`,
      heat: (d) => `Thermal ionization edge ${d.rTI} au; snow line ${d.snow} au (${d.burst} au in an outburst); the midplane at 1 au ${d.t1} K. The dead zone\u2019s and the outer disk\u2019s α keep their ratios to the inner disk\u2019s.`,
      wind: (d) => `Reaching the star: ${d.star} M☉/yr (${d.fStar} % of Ṁ). Of the flow passing 30 au on its way in, the wind carries away ${d.share} %.`,
      windOff: 'With the prescriptions of before (?mflux=0) these values do not act on the wind.',
      lamOld: 'With ?lam=old the λ values have no effect (round 8\u2019s λ).',
      planets: 'The planets\u2019 number, orbits and masses are under Show, Planets.'
    },
    quality: {
      label: 'Quality', auto: 'Auto', low: 'Low', mid: 'Medium', high: 'High', full: 'Best',
      autoNote: 'Auto: the resolution follows the device’s speed, and once the picture stops moving it is drawn again more finely.',
      fixedNote: (pct) => `Fixed: drawn at ${pct} % of the screen’s resolution (the automatic steps stop).`,
      capped: (pct) => `Too heavy in this view: held at ${pct} % so that drawing does not stall.`,
      bestNote: 'Best (the default): drawn at the screen\u2019s resolution, stepped down quietly where a view is too heavy to move smoothly.',
      bestCapped: (pct) => `Best (the default): this view is heavy, so it is drawn at ${pct} % for now.`
    },
    talk: {
      moves: { orbit: 'Orbit once', rise: 'Edge-on to face-on', powers: 'From afar to the star', planet: 'Along the disk to the planet', timelapse: 'Speed up time', looks: 'Each look in turn' },
      pace: { label: 'Pace of the moves', slow: 'Slow', normal: 'Normal', fast: 'Quick' },
      viewN: (n) => `View ${n}`,
      nameOf: (n) => `Name of scene ${n}`, up: (n) => `Move scene ${n} up`, down: (n) => `Move scene ${n} down`, remove: (n) => `Remove scene ${n}`,
      go: 'Go', goTo: (n) => `Go to scene ${n}`,
      play: 'Play', stop: 'Stop', clear: 'Remove all', clearAgain: 'Press again to remove all',
      full: (n) => `${n} scenes at most.`,
      linkCopied: 'A link to these scenes is copied.',
      linkFailed: 'The scenes in this link could not be read.',
      fromLink: (n) => (n === 1 ? 'One scene opened from the link (under “Moves and talks”).' : `${n} scenes opened from the link (under “Moves and talks”).`),
      loaded: (n) => (n === 1 ? 'One scene opened.' : `${n} scenes opened.`),
      restored: 'Your earlier scenes are back.',
      loadFailed: 'This file is not a list of scenes from Disk Lab.',
      presentHint: '→ for the next scene · Esc to end',
      last: 'This is the last scene.'
    },
    video: {
      scenes: (n) => `The scenes (${n})`, places: 'The nine highlights',
      hold: (s) => `${s} s`,
      about: (s) => (s < 90 ? `about ${Math.max(1, Math.round(s))} s` : s < 5400 ? `about ${Math.round(s / 60)} min` : `about ${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`),
      plan: (p) => `${p.seconds} s, ${p.frames} frames of ${p.w} × ${p.h} at ${p.fps} a second. ${p.level} quality (${p.sub} pictures averaged a frame${p.capped ? `; at ${p.capped} % for the gas line’s look` : ''}), on black. About ${p.mb} MB; ${p.time} on this computer (estimated; measured as it goes).`,
      long: (n, max, min) => `Too long for one video: ${n} frames, at most ${max} (${min} minutes at 30 a second). Fewer scenes, or shorter holds.`,
      big: (gb, max) => `Too large to keep in memory: about ${gb} GB, at most ${max} GB. A smaller size, or 30 frames a second.`,
      codec: (w, h, fps) => `This browser cannot encode ${w} × ${h} at ${fps} frames a second in H.264: choose a smaller size, or 30.`,
      gpu: (w, h) => `This GPU cannot draw a picture of ${w} × ${h}: choose a smaller size.`,
      noEncoder: 'This browser cannot make videos (it has no H.264 encoder through WebCodecs). Chrome or Edge, or Safari 16.4 or later, on a computer can.',
      noMotion: 'Not with reduced motion (the system’s setting): the flights and fades a video is made of are cut there.',
      preparing: 'Preparing the first frame…',
      progress: (i, n, j, m, per, left) => `Making the video: frame ${i} of ${n}${m > 1 ? ` (picture ${j} of ${m})` : ''}${per ? ` · ${per} s a frame · ${left} left` : ''}`,
      writing: 'Writing the file…',
      cancelling: 'Cancelling…',
      done: (name, mb) => `The video is saved: ${name} (${mb} MB).`,
      cancelled: 'The video was cancelled; the view is as it was.',
      failed: (why) => `The video could not be made (${why}); the view is as it was.`,
      lost: 'the GPU’s context was lost',
      slow: 'The visible and mid-infrared looks can take tens of seconds a frame at this quality (some 17 s at Best and 1080p estimated; not yet measured); Medium is several times faster.',
      credit: (y, url) => CREDIT_LINE(y, url)
    },
    probe: {
      on: 'Tap (or click) the disk in the picture for the model’s numbers at that point of the midplane; tap a planet for the planet, or above or below the disk for what lies where the line of sight passes nearest the star (tap again to move it, Esc to stop).',
      title: (r) => `Probe: the midplane at R = ${r} au`, close: 'Remove the probe',
      T: 'Temperature', rho: 'Gas density', sigma: 'Surface density', H: 'Scale height', vK: 'Keplerian speed', P: 'Orbital period', alpha: 'Turbulence α', region: 'Region', water: 'Water',
      laminar: 'none (laminar)', none: '— (no disk gas)', days: 'days', yr: 'yr',
      regions: { inner: 'thermally ionized inner disk', dead: 'dead zone', acc: 'accretion layer', base: 'wind base', wind: 'disk wind', outer: 'weakly turbulent outer disk', hall: 'Hall layer', cavity: 'magnetospheric cavity', jet: 'jet', envelope: 'envelope' },
      physics: {
        inner: (n) => `Above ${n.tTI} K the alkali metals ionize and the field couples to the gas: the magnetorotational instability stirs it strongly (α ≈ ${n.aIn}), and the accretion’s heat warms the disk from within.`,
        dead: 'Too weakly ionized for the field to couple (Ohmic diffusion): no magnetorotational turbulence, the gas is quiet. The accretion goes on in the layer above; pebbles settle to the midplane and drift inward.',
        acc: 'Where the field bends and a current flows: the gas, losing angular momentum to the wind, flows in toward the star in a thin laminar layer (heated by the current). Beyond the dead zone it lies at the midplane.',
        base: 'The field opens out and the gas is slowly lifted toward the wind (ambipolar diffusion dominates; no turbulence).',
        wind: 'Ionized by the star’s ultraviolet light, the gas flows out along the field lines: the disk wind carries angular momentum away and drives the accretion.',
        outer: (n) => `Cosmic rays reach the midplane, so the field couples, but ambipolar diffusion keeps the turbulence weak (α ≈ ${n.aOut}).`,
        hall: 'With the field aligned with the rotation, the Hall effect pushes the current layer to one side; below it the field is wound one way.',
        cavity: 'Inside the star’s magnetosphere, which truncates the gas disk: the gas falls onto the star along the field lines.',
        jet: 'The narrow, fast jet launched along the axis close to the star.',
        envelope: 'The remains of the parent cloud, falling onto the star and the disk it surrounds.'
      },
      snowIn: (r) => `vapour (inside the snow line at ${r} au)`, snowOut: (r) => `ice (outside the snow line at ${r} au)`, snowOutWarm: (r) => `vapour (outside the snow line at ${r} au, but warmer than 160 K here)`,
      gap: (o) => `in the gap of the planet at ${o.a} au: the gas at ${o.f} % of its surroundings (the gap ${o.depth} % deep at the orbit, ${o.w} au wide at half depth: Kanagawa et al. 2016)${o.bump ? `; the pressure maximum, where pebbles collect, at ${o.bump} au` : ''}`, trap: (a) => `at the pressure maximum outside the planet at ${a} au: pebbles collect here`,
      // (round 15a) a planet's point; the magnetosphere; above the disk (the wind, the jet, the envelope)
      planetTitle: (a) => `Probe: the planet at ${a} au`, mass: 'Mass', hill: 'Hill radius', qth: 'Thermal mass (q / h³)',
      gapOf: (o) => `Its gap (Kanagawa et al. 2016, α = ${o.alpha}, K = ${o.K}): ${o.depth} % deep at the orbit, ${o.w} au wide at half depth.`,
      bump: (r) => `The pressure maximum, where pebbles collect: ${r} au.`, noGap: 'Too light to open a gap in the model.',
      cpdOf: (o) => `Its own ${o.kind === 'disk' ? 'circumplanetary disk' : 'envelope'}: out to ${o.rOut} au (${o.rOutH} R_H), about ${o.T} K halfway out, accreting ${o.mdot} (${o.auto ? 'auto: a tenth of the disk’s rate' : 'as set'}).`,
      aboveTitle: (o) => `Probe: ${o.below ? 'below' : 'above'} the disk, where the line of sight passes nearest the star, r = ${o.r} au (R = ${o.R} au, |z| = ${o.z} au)`,
      rT: 'Truncation radius r_T', curtains: 'Accretion curtains', vff: 'Free fall from r_T', rCo: 'Corotation radius',
      curtainsV: (a, b) => `along the field lines leaving the disk at ${a} to ${b} au, onto the star about 25° from its poles`,
      vffV: (here, star) => `${here} km/s here, ${star} km/s at the star’s surface`, rCoV: (r, d) => `${r} au (the star turns in ${d} days)`,
      windRho: 'Gas density (the wind)', windV: 'Speed along the field line', windRot: 'Rotation', windFoot: 'Launched from', windTerm: 'Terminal speed',
      windFootV: (r, lam, bud) => `R = ${r} au, lever arm λ ${lam}${bud ? ` (the mass budget’s ${bud})` : ''}`,
      jetV: 'Speed', envV: 'Speed of the fall', noScale: 'not given (the model has no physical scale for it)',
      hidden: 'Not shown now (turn it on under Show).', inCavity: 'In the outflow’s cavity along the axis, cleared of the envelope’s gas.', beyondEnv: 'Beyond the envelope the model draws (560 au).',
      // (round 13e) inside a planet's own disk (or envelope)
      cpd: (o) => `inside the ${o.kind === 'disk' ? 'circumplanetary disk' : 'envelope'} of the planet at ${o.a} au (${o.m}): ${o.r} from the planet (${o.rH} R_H; its edge at ${o.rOut} R_H), ${o.T} K, H/r ${o.Hr}, accreting ${o.mdot}`,
      model: (n) => `The model’s values (the disk drawn ${n.hf} times as thick as its temperature holds it up, for the picture; the surface density taken as 1700 g/cm² at 1 au).`   // (round 14a: n from the model's parameters)
    },
    cite: {
      lead: 'Free to use in research, talks, teaching and materials; no credit required. If you cite it, this line will do.',
      line: (y, url, v) => CITE_LINE(y, url, v),
      copy: 'Copy the citation', copied: 'Citation copied.'
    },
    tilt: {
      label: 'Tilt to look in',
      off: 'Tilting the phone turns the view a little (up to 6°), as if you held the disk in your hand. It does not go into links or the settings kept on this device.',
      on: 'On: tilt the phone to look in. It rests during moves, Play, the presenter and a drag.',
      asking: 'Asking the browser for the motion sensor…',
      denied: 'The motion sensor was not allowed, so this stays off. To use it, allow “Motion & Orientation Access” in the browser’s settings, then turn this on again.',
      failed: 'The motion sensor could not be used, so this stays off.',
      none: 'No tilt comes from this device, so this is off.',
      touch: 'On: touch the screen once to start the tilt sensor (the browser may ask).',
      reduced: 'Not available while motion is reduced.'
    },
    // (round 18a) the rail's View and Background: the camera's roll about the line of sight and the number of the background's stars
    // (app.js, renderRoll and renderStars)
    view: {
      roll: 'Roll', rollOf: 'Roll of the view about the line of sight', rollReset: 'Roll back to 0°', rollVal: (d) => `${d}°`,
      stars: 'Stars', starsOf: 'Number of the background’s stars (times the default)', starsReset: 'Stars: back to the default number', starsVal: (k) => `× ${k}`,
      aim: 'Point looked at', aimLeft: 'Move the point looked at left', aimUp: 'Move the point looked at up', aimDown: 'Move the point looked at down',
      aimRight: 'Move the point looked at right', aimStar: 'Back to the star', aimStarOf: 'Point looked at back to the star',
      aimPlanet: 'Back to the planet', aimPlanetOf: 'Point looked at back to the planet'
    }
  }
};
