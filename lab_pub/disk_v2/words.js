// Words that change with the state of the page, in both languages (the fixed text is in index.html, in .en/.ja spans).
// Rules (DESIGN.md, section 4): short and exact; a technical term is said plainly once; units with numbers.

export const WORDS = {
  ja: {
    places: {
      whole: { short: '全体', title: '円盤の全体',
        text: '若い星を回るガスと塵の円盤(半径 30 au)。惑星はこうした円盤で生まれます。星の光は反り返った表層を温め、赤道面は冷たいまま。上に淡く光るのは円盤風です。' },
      wind: { short: '磁場と風', title: '磁場と円盤風',
        text: '円盤を貫く磁力線は、回転にねじられながら外へ開きます。ガスはこの線に沿って加速し、風となって上下に吹き出します。磁場が回転と同じ向きなら、片側が強くなります。' },
      snow: { short: 'スノーライン', title: 'スノーライン',
        text: '約 0.9 au の破線がスノーライン。その外では、赤道面の小石が氷をまといます。3 au では木星質量の惑星がギャップを開けています。' },
      planet: { short: '惑星', title: '惑星',
        text: '3 au を回る木星質量の惑星。ガスを押しのけてギャップを開け、自分の小さな円盤を持ちます。奥で明るいのは、星に照らされたギャップの外壁です。' },
      mm: { short: 'ミリ波', title: 'ミリ波で見る',
        text: 'ミリ波(ALMA の波長)では、赤道面の小石が光ります。惑星のギャップは暗い溝に、そのすぐ外にたまった小石は明るい環になります。' },
      heat: { short: '温度', title: '円盤の中の温度',
        text: '星を通る面で手前の半分を切り取り、切り口を温度で塗りました。白い線(τ* = 1)より上は星の光で熱く、その下は冷たいままです。' },
      deadzone: { short: 'デッドゾーン', title: 'デッドゾーン',
        text: '右手前の 4 分の 1 を切り取り、磁場とガスの結びつきで塗り分けました。紺のデッドゾーンでは磁場がガスをつかめず、乱流も起きません。降着は、その上下の薄い層(琥珀色)を流れます。' },
      star: { short: '星のそば', title: '星のすぐそば',
        text: '星から 0.15 au。星の磁場が円盤を 0.05 au で切り取り、ガスは磁力線に沿う弧状のカーテン(桃色)となって星へ落ちます(秒速約 400 km)。' },
      afar: { short: '遠くから', title: '遠くから',
        text: '340 au から。母体の雲の名残(エンベロープ)が回転しながら円盤へ落ち、軸に沿って開いた空洞の壁が、星の光で明るく見えます。' }
    },
    looks: {
      model: { label: 'モデル', note: '色は温度(青は冷たく、白はスノーライン、橙から黄は熱い)、明るさは吸収した星の光です。' },
      optical: { label: '散乱光', note: '可視光・近赤外線の散乱光。星の光を散らす表層と風が見えます。' },
      mir: { label: '中間赤外', note: '中間赤外線。暖かい表層が自ら光り、内側ほど明るく見えます。' },
      mm: { label: 'ミリ波', note: 'ミリ波。赤道面に沈んだ小石の熱放射です。' },
      co: { label: 'CO', note: 'CO 分子の回転輝線。ドップラー効果で、ガスの動きが色と形に現れます。' }
    },
    coModes: { chan: 'チャンネル', m1: '平均速度', m0: '積分強度' },
    coNotes: {
      chan: '視線速度がこの値に近いガスだけが光ります。',
      m1: '平均の視線速度(モーメント 1)。赤は遠ざかり、青は近づくガスです。',
      m0: '輝線の強さを速度について足し合わせたもの(モーメント 0)です。'
    },
    velocity: '視線速度',
    cutQ: { T: '温度', rho: '密度', tau: '星の光の深さ', layers: '層構造', none: '透かし' },
    cutNotes: {
      T: '切り口の色は温度(対数の尺度)。白い線は τ* = 1、水色の破線は氷の境目です。',
      rho: '切り口の色はガスの密度(1 au の赤道面に対する比、対数の尺度)です。',
      tau: '切り口の色は星へ向かう光学的厚さ τ*(対数の尺度)。白い線 τ* = 1 が、星の光が届く深さです。',
      layers: '切り口の色は磁場とガスの結びつき。色の意味は左上にあります。',
      none: '切り口をそのまま見せ、奥のガスは薄くしています。白い線は円盤の縁、細い線は密度の等高線です。'
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
    clock: (y) => `${y.toFixed(1)} 年`,
    hintMouse: 'ドラッグで回転 · スクロールで拡大',
    hintTouch: '1 本指で移動 · 2 本指で拡大と回転',
    loading: '準備しています…',
    reduced: '動きを減らす設定のため、時計を止めています。',
    linkCopied: 'リンクをコピーしました。',
    linkShown: 'リンクを表示しました。選んでコピーしてください。',
    imageBusy: '画像を作っています…',
    imageDone: '画像を保存しました。',
    imageFailed: '画像を作れませんでした。',
    still: {
      nogl: 'このブラウザーでは動くモデルを描けないため(WebGL 2 が必要です)、同じモデルの静止画を表示しています。',
      software: 'この端末の WebGL はソフトウェアで描いていて、動くモデルには遅すぎます。同じモデルの静止画を表示しています。',
      slow: 'この端末では描画が遅すぎるため、同じモデルの静止画を表示しています。',
      failed: '動くモデルを始められなかったため、同じモデルの静止画を表示しています。',
      forced: '静止画を表示しています。',
      lost: '描画が中断しました。戻るまで静止画を表示します。',
      tryLive: 'それでも動かす'
    },
    ariaStage: '円盤のモデル',
    ariaRoute: '行き先'
  },
  en: {
    places: {
      whole: { short: 'Whole disk', title: 'The whole disk',
        text: 'A disk of gas and dust around a young star, 30 au in radius: the kind of disk in which planets form. Starlight warms its flared surface; the midplane stays cold. The faint glow above is a wind.' },
      wind: { short: 'Field & wind', title: 'Field and wind',
        text: 'Field lines threading the disk are wound up by its rotation and open outward. Gas speeds up along them and leaves both faces as a wind; with the field aligned with the rotation, one side blows harder.' },
      snow: { short: 'Snow line', title: 'The snow line',
        text: 'The dashed ring near 0.9 au is the snow line: beyond it, the pebbles at the midplane are coated in ice. A Jupiter-mass planet at 3 au opens a gap.' },
      planet: { short: 'Planet', title: 'The planet',
        text: 'A Jupiter-mass planet at 3 au pushes the gas aside into a gap and keeps a small disk of its own. Behind it, starlight catches the outer wall of the gap.' },
      mm: { short: 'Millimetre', title: 'In millimetre light',
        text: 'At millimetre wavelengths (ALMA\u2019s) the pebbles at the midplane glow. The planet\u2019s gap shows as a dark lane; the pebbles trapped just outside it form a bright ring.' },
      heat: { short: 'Heat', title: 'Heat inside the disk',
        text: 'The near half cut away through the star, the face coloured by temperature. Above the white line (\u03c4* = 1) starlight heats the gas; below it the disk stays cold.' },
      deadzone: { short: 'Dead zone', title: 'The dead zone',
        text: 'A quarter cut away, coloured by how well the magnetic field grips the gas. In the navy dead zone it cannot, and nothing stirs; accretion runs through thin layers above and below it (amber).' },
      star: { short: 'The star', title: 'Next to the star',
        text: 'At 0.15 au, the star\u2019s magnetic field holds the disk off at 0.05 au. Gas falls onto the star along the field lines in arc-shaped curtains (pink), at about 400 km/s.' },
      afar: { short: 'Afar', title: 'From afar',
        text: 'From 340 au: the remains of the parent cloud (the envelope) fall onto the disk as they rotate, and starlight lights the walls of a cavity along the axis.' }
    },
    looks: {
      model: { label: 'Model', note: 'Colour is temperature (blue cold, white at the snow line, orange to yellow hot); brightness is the starlight absorbed.' },
      optical: { label: 'Scattered', note: 'Visible and near-infrared light, scattered by the surface and the wind.' },
      mir: { label: 'Mid-IR', note: 'Mid-infrared: the warm surface glows, brightest close in.' },
      mm: { label: 'Millimetre', note: 'Millimetre: the thermal glow of the pebbles at the midplane.' },
      co: { label: 'CO', note: 'The rotational line of carbon monoxide: its Doppler shift shows how the gas moves.' }
    },
    coModes: { chan: 'Channel', m1: 'Velocity', m0: 'Intensity' },
    coNotes: {
      chan: 'Only gas moving near this line-of-sight velocity shines.',
      m1: 'Mean line-of-sight velocity (moment 1): red recedes, blue approaches.',
      m0: 'The line’s strength summed over velocity (moment 0).'
    },
    velocity: 'Velocity',
    cutQ: { T: 'Temperature', rho: 'Density', tau: 'Starlight depth', layers: 'Layers', none: 'See-through' },
    cutNotes: {
      T: 'The cut face shows temperature (logarithmic). The white line is \u03c4* = 1; the dashed blue line is the ice boundary.',
      rho: 'The cut face shows gas density, relative to the midplane at 1 au (logarithmic).',
      tau: 'The cut face shows the optical depth toward the star, \u03c4* (logarithmic); the white line, \u03c4* = 1, is how deep starlight reaches.',
      layers: 'The cut face shows how the field couples to the gas; the key is at the top left.',
      none: 'The cut face as it is, with the gas behind it thinned; the white line is the disk\u2019s edge, the thin lines density contours.'
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
    clock: (y) => `${y.toFixed(1)} yr`,
    hintMouse: 'Drag to turn · scroll to zoom',
    hintTouch: 'One finger moves · two zoom and turn',
    loading: 'Preparing…',
    reduced: 'Reduced motion is on, so the clock is stopped.',
    linkCopied: 'Link copied.',
    linkShown: 'The link is shown below; select it to copy.',
    imageBusy: 'Making the image…',
    imageDone: 'Image saved.',
    imageFailed: 'The image could not be made.',
    still: {
      nogl: 'This browser can’t draw the live model (it needs WebGL 2), so these are still pictures of the same model.',
      software: 'WebGL here runs in software, too slow for the live model, so these are still pictures of the same model.',
      slow: 'This device draws the model too slowly, so these are still pictures of the same model.',
      failed: 'The live model could not start, so these are still pictures of the same model.',
      forced: 'Showing still pictures.',
      lost: 'Drawing was interrupted; a still picture shows until it recovers.',
      tryLive: 'Run the live model anyway'
    },
    ariaStage: 'Model of a protoplanetary disk',
    ariaRoute: 'Places'
  }
};
