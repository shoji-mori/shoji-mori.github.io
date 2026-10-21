// Words that change with the state of the page, in both languages (the fixed text is in index.html, in .en/.ja spans).
// Rules (DESIGN.md, section 4): short and exact; a technical term is said plainly once; units with numbers.

// The citation, one line in English for both languages (round 8)
const CITE_LINE = (y, url, v) => `Mori, S. ${y}, Disk Lab: an interactive model of a protoplanetary disk (v${v}), ${url}`;

export const WORDS = {
  ja: {
    places: {
      whole: { short: '全体', title: '円盤の全体',
        text: '若い星を回るガスと塵の円盤(半径 30 au)。惑星はこうした円盤で生まれます。星の光は反り返った表層を温め、赤道面は冷たいまま。上に淡く光るのは円盤風です。' },
      wind: { short: '磁場と風', title: '磁場と円盤風',
        text: '円盤を貫く磁力線は、回転にねじられながら外へ開きます。ガスはこの線に沿って加速し、風となって上下に吹き出します。磁場が回転と同じ向きなら、片側が強くなります。' },
      snow: { short: 'スノーライン', title: 'スノーライン',
        text: '約 1 au の破線がスノーライン。その外では、赤道面の小石が氷をまといます。すぐ外に小石が少したまり、内側では氷が昇華して岩の粒になります。' },
      planet: { short: '惑星', title: '惑星',
        text: '3 au を回る木星質量の惑星。ガスを押しのけてギャップを開け、自分の小さな円盤を持ちます。奥で明るいのは、星に照らされたギャップの外壁です。' },
      mm: { short: 'ミリ波', title: 'ミリ波で見る',
        text: 'ミリ波(ALMA の波長)では、赤道面の小石が光ります。惑星のギャップは暗い溝に、そのすぐ外にたまった小石は明るい環になります。' },
      heat: { short: '温度', title: '円盤の中の温度',
        text: '手前の半分を切り取り、切り口を温度で塗りました。白い線(τ* = 1)より上では星の光で塵が熱く、その下の内部はぬるいまま。0.3 au より内側だけは降着の熱で赤道面が最も熱くなります。' },
      deadzone: { short: 'デッドゾーン', title: 'デッドゾーン',
        text: '右手前の 4 分の 1 を切り取り、何が起きている所かで塗り分けました。紺のデッドゾーンでは磁場がガスをつかめず、乱流も起きません。降着はそのすぐ上の薄い層(琥珀色)を流れ、そこで磁力線が折れ曲がります。その上は円盤風の根元です。' },
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
    cutQ: { T: '温度', rho: '密度', layers: '領域' },
    cutNotes: {
      T: '切り口の色は温度です(対数の尺度、左上の目盛り)。',
      rho: '切り口の色はガスの密度です(1 au の赤道面に対する比、対数の尺度)。',
      layers: '切り口を、何が起きている所か(乱流、デッドゾーン、降着層、風の根元、円盤風)で塗り分けています(色の意味は左上)。'
    },
    // the key of the cut's lines and of what is left clear (round 6: the names are no longer on the face)
    cutKey: {
      tau1: '星の光が届く深さ(τ* = 1)', tau1Regions: '星の光が届く深さ(τ* = 1):円盤風の基部',
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
    back: 'この視点に戻る',
    onward: '次へ:', again: 'はじめから:',
    count: (i, n) => `${i} / ${n}`,
    prev: '前の場所', next: '次の場所',
    play: '再生', pause: '一時停止',
    clockRate: (n) => `今は ×1/${n}。`,
    hintMouse: 'ドラッグで回転 · スクロールで拡大',
    hintTouch: '1 本指で移動 · 2 本指で拡大と回転',
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
      note: (w, h) => `保存する画像:${w} × ${h} px(線と文字と印も同じ大きさで)。`,
      lower: (w, h, pct) => `保存する画像:${w} × ${h} px。この見え方は重いため、ガスは ${pct} % の細かさで描きます。`,
      coScreen: (w, h) => `この見え方は計算が重いため、画面と同じ ${w} × ${h} px で保存します。`
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
    preparingLook: 'この表示を準備しています…',
    heavyStill: 'この見え方はこの端末で動かすには重いため、時計を止めて静止画で描いています(再生ボタンで動かすこともできます)。',
    safeStart: '前回は描画が止まったため、安全な設定(モデル、断面なし、画質は自動、全体の眺め)で始めました。',
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
    ariaRoute: '行き先',
    show: {
      gas: 'ガス', pebbles: '小石', wind: '円盤風', jet: 'ジェット', field: '磁力線', planet: '惑星', envelope: 'エンベロープ', labels: '注釈',
      asym: '上下非対称(Mori, Bai & Tomida 2025)', marks: '流れの矢印', waves: '波を強調',
      planetRow: (i, a) => `${i}  ${a} au`, orbit: (i) => `惑星 ${i} の軌道半径`, massOf: (i) => `惑星 ${i} の質量`, remove: '外す',
      addPlanet: '惑星を置く', picking: '円盤をクリックした半径に惑星を置きます(Esc でやめる)。',
      drop: 'タップで小石を置く', dropping: '円盤をタップ(クリック)すると、そこに小石の塊を置きます。同じ半径に 3 つ続けて置くと、惑星が育ちます(Esc でやめる)。', placed: (a) => `${a} au に惑星を置きました。`,
      noRoom: 'そこには置けません(0.05〜20 au、隣の惑星から相互ヒル半径の 4 倍以上)。', full: '惑星は 4 つまでです。',
      planetsNote: '軌道半径 0.05〜20 au(内側の端は、星の磁場が円盤を切り取る所)、質量は地球の 10 倍から木星の 3 倍(重いほどギャップが深く広く、小石の環は孤立質量を超えるとできます)。隣どうしは相互ヒル半径の 4 倍以上離します(近すぎる軌道は不安定です)。絵の中の惑星をクリックしても動かせます。'
    },
    quality: {
      label: '画質', auto: '自動', low: '低', mid: '中', high: '高', full: '最高',
      autoNote: '自動:端末の速さに合わせて解像度を変え、止まった絵は細かく描き直します。',
      fixedNote: (pct) => `固定:画面の解像度の ${pct} % で描きます(自動の調整は止まります)。`,
      capped: (pct) => `この眺めでは重すぎるため、${pct} % に下げています(描画が止まらないように)。`,
      bestNote: '最高(既定):画面の解像度で描きます。重い眺めでは、動きが止まらないよう静かに一段ずつ下げます。',
      bestCapped: (pct) => `最高(既定):この眺めは重いため、いまは ${pct} % で描いています。`,
      coCapped: (pct) => `ガス輝線の見え方では、いまは ${pct} % に抑えています(この見え方の計算はまだ短く区切っていないため)。`
    },
    // (round 8, the owner: "the citation in English in Japanese too": the lead stays Japanese, the line is the English one)
    cite: {
      lead: '研究や発表での利用は自由です。出典として、このページを引用してください。',
      line: (y, url, v) => CITE_LINE(y, url, v),
      copy: '引用をコピー', copied: '引用をコピーしました。'
    }
  },
  en: {
    places: {
      whole: { short: 'Whole disk', title: 'The whole disk',
        text: 'A disk of gas and dust around a young star, 30 au in radius: the kind of disk in which planets form. Starlight warms its flared surface; the midplane stays cold. The faint glow above is a wind.' },
      wind: { short: 'Field & wind', title: 'Field and wind',
        text: 'Field lines threading the disk are wound up by its rotation and open outward. Gas speeds up along them and leaves both faces as a wind; with the field aligned with the rotation, one side blows harder.' },
      snow: { short: 'Snow line', title: 'The snow line',
        text: 'The dashed ring near 1 au is the snow line: beyond it, the pebbles at the midplane are coated in ice. They pile up a little just outside it; inside, the ice sublimates and the grains are bare rock.' },
      planet: { short: 'Planet', title: 'The planet',
        text: 'A Jupiter-mass planet at 3 au pushes the gas aside into a gap and keeps a small disk of its own. Behind it, starlight catches the outer wall of the gap.' },
      mm: { short: 'Millimetre', title: 'In millimetre light',
        text: 'At millimetre wavelengths (ALMA\u2019s) the pebbles at the midplane glow. The planet\u2019s gap shows as a dark lane; the pebbles trapped just outside it form a bright ring.' },
      heat: { short: 'Heat', title: 'Heat inside the disk',
        text: 'The near half cut away through the star, the face coloured by temperature. Above the white line (\u03c4* = 1) starlight makes the dust hot; the interior below stays cool. Only inside 0.3 au does accretion make the midplane the hottest.' },
      deadzone: { short: 'Dead zone', title: 'The dead zone',
        text: 'A quarter cut away, coloured by what happens there. In the navy dead zone the field cannot grip the gas, and nothing stirs; accretion runs in a thin layer just above it (amber), where the field lines bend, and above that the wind is launched.' },
      star: { short: 'The star', title: 'Next to the star',
        text: 'At 0.15 au, the star\u2019s magnetic field holds the disk off at 0.05 au. Gas falls onto the star along the field lines in arc-shaped curtains (pink), at about 400 km/s.' },
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
    cutQ: { T: 'Temperature', rho: 'Density', layers: 'Regions' },
    cutNotes: {
      T: 'The cut face shows temperature (logarithmic; the scale at the top left).',
      rho: 'The cut face shows gas density, relative to the midplane at 1 au (logarithmic).',
      layers: 'The cut face is divided by what happens there: turbulence, the dead zone, the accretion layer, the wind base, the wind (the key at the top left).'
    },
    cutKey: {
      tau1: 'Where starlight reaches (\u03c4* = 1)', tau1Regions: 'Where starlight reaches (\u03c4* = 1): the wind\u2019s base',
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
    hintTouch: 'One finger moves · two zoom and turn',
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
      coScreen: (w, h) => `This look is heavy to compute, so it is saved as the screen, ${w} × ${h} px.`
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
    preparingLook: 'Preparing this view…',
    heavyStill: 'This look is too heavy to animate on this device, so the clock is paused and it is drawn as a still (the play button animates it anyway).',
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
    ariaRoute: 'Places',
    show: {
      gas: 'Gas', pebbles: 'Pebbles', wind: 'Wind', jet: 'Jet', field: 'Field lines', planet: 'Planets', envelope: 'Envelope', labels: 'Labels',
      asym: 'One-sided (Mori, Bai & Tomida 2025)', marks: 'Flow arrows', waves: 'Exaggerate the waves',
      planetRow: (i, a) => `${i}  ${a} au`, orbit: (i) => `Planet ${i}: orbital radius`, massOf: (i) => `Planet ${i}: mass`, remove: 'Remove',
      addPlanet: 'Place a planet', picking: 'Click the disk where the planet should orbit (Esc to stop).',
      drop: 'Tap to drop pebbles', dropping: 'Tap (or click) the disk to drop a clump of pebbles there; three in a row near one radius grow a planet (Esc to stop).', placed: (a) => `A planet placed at ${a} au.`,
      noRoom: 'No room there (0.05 to 20 au, and at least four mutual Hill radii from a neighbour).', full: 'Four planets at most.',
      planetsNote: 'Orbits of 0.05 to 20 au (the inner end is where the star\u2019s magnetic field cuts off the disk); masses of 10 Earths to 3 Jupiters (heavier planets open deeper, wider gaps, and those above the pebble isolation mass ring their gaps with pebbles). Neighbours are kept at least four mutual Hill radii apart (closer orbits are unstable). A planet in the picture can be clicked to move it too.'
    },
    quality: {
      label: 'Quality', auto: 'Auto', low: 'Low', mid: 'Medium', high: 'High', full: 'Best',
      autoNote: 'Auto: the resolution follows the device’s speed, and a still picture is drawn again more finely.',
      fixedNote: (pct) => `Fixed: drawn at ${pct}% of the screen’s resolution (the automatic steps stop).`,
      capped: (pct) => `Too heavy in this view: held at ${pct}% so that drawing does not stall.`,
      bestNote: 'Best (the default): drawn at the screen\u2019s resolution, stepped down quietly where a view is too heavy to move smoothly.',
      bestCapped: (pct) => `Best (the default): this view is heavy, so it is drawn at ${pct}% for now.`,
      coCapped: (pct) => `In the gas line's look the picture is held at ${pct}% for now (its passes are not yet cut into short pieces).`
    },
    cite: {
      lead: 'Free to use in research and talks; please cite this page as the source.',
      line: (y, url, v) => CITE_LINE(y, url, v),
      copy: 'Copy the citation', copied: 'Citation copied.'
    }
  }
};
