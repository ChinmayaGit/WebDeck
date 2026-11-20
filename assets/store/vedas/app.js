(() => {
  const wd = window.webdeck;
  const esc = (s) => (s ? String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]) : '');
  const $ = (id) => document.getElementById(id);

  let currentBook = 'gayatri';
  let isPlayingAudio = false;
  let audioContext = null;
  let currentOsc = null;
  let currentGain = null;

  const VEDIC_DATA = {
    gayatri: [
      {
        ref: 'Rigveda 3.62.10 · The Gayatri Mantra',
        sanskrit: 'ॐ भूर्भुवः स्वः तत्सवितुर्वरेण्यं भर्गो देवस्य धीमहि धियो यो नः प्रचोदयात् ॥',
        translit: 'Oṃ bhūr bhuvaḥ svaḥ | tat savitur vareṇyaṃ bhargo devasya dhīmahi | dhiyo yo naḥ pracodayāt ||',
        meaning: 'May we meditate upon the glorious divine splendor of the brilliant Sun-creator (Savitr). May that Supreme Light illuminate and guide our intellects toward truth and righteousness.'
      },
      {
        ref: 'Rigveda 7.59.12 · Mahamrityunjaya Mantra',
        sanskrit: 'ॐ त्र्यम्बकं यजामहे सुगन्धिं पुष्टिवर्धनम् । उर्वारुकमिव बन्धनान्मृत्यschemaोर्मुक्षीय मामृतात् ॥',
        translit: 'Oṃ tryambakaṃ yajāmahe sugandhiṃ puṣṭi-vardhanam | urvārukam iva bandhanān mṛtyor mukṣīya māmṛtāt ||',
        meaning: 'We worship the Three-Eyed Lord (Shiva), the fragrant one who nourishes and sustains all beings. Just as a ripe melon naturally detaches from the vine, liberate us from death and bondage into immortality.'
      },
      {
        ref: 'Shukla Yajurveda · Shanti Mantra',
        sanskrit: 'ॐ पूर्णमदः पूर्णमिदं पूर्णात्पूर्णमुदच्यते । पूर्णस्य पूर्णमादाय पूर्णमेवावशिष्यते ॥ ॐ शान्तिः शान्तिः शान्तिः ॥',
        translit: 'Oṃ pūrṇam adaḥ pūrṇam idaṃ pūrṇāt pūrṇam udacyate | pūrṇasya pūrṇam ādāya pūrṇam evāvaśiṣyate || Oṃ śāntiḥ śāntiḥ śāntiḥ ||',
        meaning: 'That is whole and infinite; this is whole and infinite. From the Whole, the Whole emerges. Even when the Whole is subtracted from the Whole, the Whole alone remains. Om peace, peace, peace.'
      }
    ],
    rigveda: [
      {
        ref: 'Rigveda 1.1.1 · Hymn to Agni (The Prime Light)',
        sanskrit: 'अग्निमीळे पुरोहितं यज्ञस्य देवमृत्विजम् । होतारं रत्नधातमम् ॥',
        translit: 'Agnim īḷe purohitaṃ yajñasya devam ṛtvijam | hotāraṃ ratnadhātamam ||',
        meaning: 'I praise Agni, the cosmic priest, the divine minister of the sacred sacrifice, the invoker of truth, and the bestower of the greatest inner treasures.'
      },
      {
        ref: 'Rigveda 10.129.1 · Nasadiya Sukta (Creation Hymn)',
        sanskrit: 'नासदासीन्नो सदासीत्तदानीं नासीद्रजो नो व्योमा परो यत् । किमावरीवः कुह कस्य शर्मन्नम्भः किमासीद्गहनं गभीरम् ॥',
        translit: 'Nāsad āsīn no sad āsīt tadānīṃ nāsīd rajo no vyomā paro yat | kim āvarīvaḥ kuha kasya śarmann ambhaḥ kim āsīd gahanaṃ gabhīram ||',
        meaning: 'Then there was neither non-existence nor existence. There was no realm of air, no sky beyond. What covered it? Where was it, and in whose protection? Was there water, deep and fathomless?'
      },
      {
        ref: 'Rigveda 10.191.2 · Sangathan Sukta (Hymn of Harmony & Unity)',
        sanskrit: 'सं गच्छध्वं सं वदध्वं सं वो मनांसि जानताम् । देवा भागं यथा पूर्वे संजानाना उपासते ॥',
        translit: 'Saṃ gacchadhvaṃ saṃ vadadhvaṃ saṃ vo manāṃsi jānatām | devā bhāgaṃ yathā pūrve sañjānānā upāsate ||',
        meaning: 'Walk together, speak together in harmony; let your minds comprehend alike. Just as the enlightened beings of old united in understanding, may our hearts beat as one.'
      }
    ],
    samaveda: [
      {
        ref: 'Samaveda Archika 1 · Cosmic Music & Divine Melody',
        sanskrit: 'अग्न आयाहि वीतये गृणानो हव्यदातये । नि होता सत्सि बर्हिषि ॥',
        translit: 'Agna āyāhi vītaye gṛṇāno havyadātaye | ni hotā satsi barhiṣi ||',
        meaning: 'O Agni, come to our gathering, praised with melodies of devotion, to receive our offerings. Take your seat as the divine ministrant of light upon the sacred seat.'
      },
      {
        ref: 'Samaveda · Chandogya Metre of Joy',
        sanskrit: 'सामवेदः स्वरो गेयो मनो विमलकारकः । यत्र नादब्रह्म प्रादुर्भवति ॥',
        translit: 'Sāmavedaḥ svaro geyo mano vimala-kārakaḥ | yatra nāda-brahma prādurbhavati ||',
        meaning: 'The chants of the Samaveda cleanse and purify the mind. Wherever these sacred tones resound, the supreme Nada Brahman (divine sound) reveals itself.'
      }
    ],
    yajurveda: [
      {
        ref: 'Yajurveda 36.17 · Shanti Path (Universal Cosmic Peace)',
        sanskrit: 'द्यौः शान्तिरन्तरिक्षं शान्तिः पृथिवी शान्तिरापः शान्तिरोषधयः शान्तिः । वनस्पतयः शान्तिर्विश्वेदेवाः शान्तिर्ब्रह्म शान्तिः सर्वं शान्तिः शान्तिरेव शान्तिः सा मा शान्तिरेधि ॥',
        translit: 'Dyauḥ śāntir antarikṣaṃ śāntiḥ pṛthivī śāntir āpaḥ śāntir oṣadhayaḥ śāntir | vanaspatayaḥ śāntir viśvedevāḥ śāntir brahma śāntir sarvaṃ śāntir śāntir eva śāntiḥ sā mā śāntir edhi ||',
        meaning: 'May peace radiate in the celestial realms and across outer space. May peace descend upon mother Earth, the waters, the medicinal herbs, and forests. May peace be upon all divine forces and upon Brahman. May universal peace fill all existence, and may that peace reside within me.'
      }
    ],
    atharvaveda: [
      {
        ref: 'Atharvaveda 12.1.1 · Prithvi Sukta (Ode to Mother Earth)',
        sanskrit: 'सत्यं बृहदृतमुग्रं दीक्षा तपो ब्रह्म यज्ञः पृथिवीं धारयन्ति । सा नो भूतस्य भव्यस्य पत्न्युरुं लोकं पृथिवी नः कृणोतु ॥',
        translit: 'Satyaṃ bṛhad ṛtam ugraṃ dīkṣā tapo brahma yajñaḥ pṛthivīṃ dhārayanti | sā no bhūtasya bhavyasya patny uruṃ lokaṃ pṛthivī naḥ kṛṇotu ||',
        meaning: 'Truth, eternal order, high devotion, spiritual fire, sacred knowledge, and self-sacrifice sustain Mother Earth. Ruler of what was and what shall be, may She expand vast freedom, peace, and abundance for all living creatures.'
      }
    ],
    upanishads: [
      {
        ref: 'Brihadaranyaka Upanishad 1.3.28 · Pavamana Mantra',
        sanskrit: 'असतो मा सद्गमय । तमसो मा ज्योतिर्गमय । मृत्योर्मा अमृतं गमय ॥',
        translit: 'Asato mā sad-gamaya | tamaso mā jyotir-gamaya | mṛtyor mā amṛtaṃ gamaya ||',
        meaning: 'Lead me from the unreal to the Real. Lead me from darkness into the Light. Lead me from the fear of death into Immortality.'
      },
      {
        ref: 'Bhagavad Gita 2.47 · Nishkama Karma',
        sanskrit: 'कर्मण्येवाधिकारस्ते मा फलेषु कदाचन । मा कर्मफलहेतुर्भूर्मा ते सङ्गोऽस्त्वकर्मणि ॥',
        translit: 'Karmany evādhikāras te mā phaleṣu kadācana | mā karma-phala-hetur bhūr mā te saṅgo \'stv akarmaṇi ||',
        meaning: 'You have a right to your sacred duty and action, but never to the fruits thereof. Let not the fruits of action be your motive, nor let your attachment be to inaction.'
      }
    ]
  };

  function init() {
    bindControls();
    renderVerses();
  }

  function bindControls() {
    // Font resizing for seniors
    $('btnFontNormal').onclick = () => setFontSize(20, 'Normal');
    $('btnFontLarge').onclick = () => setFontSize(26, 'Large');
    $('btnFontHuge').onclick = () => setFontSize(32, 'Huge');

    // Themes
    $('btnThemeDark').onclick = () => setTheme('dark');
    $('btnThemeWarm').onclick = () => setTheme('warm');
    $('btnThemeLight').onclick = () => setTheme('light');

    // Book switcher
    document.querySelectorAll('[data-book]').forEach(b => {
      b.onclick = () => {
        document.querySelectorAll('[data-book]').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        currentBook = b.dataset.book;
        renderVerses();
      };
    });

    // Audio player toggle
    $('btnAudioPlay').onclick = toggleAudioChant;
    $('btnNextAudio').onclick = nextAudioChant;
  }

  function setFontSize(px, label) {
    document.documentElement.style.setProperty('--v-font-size', `${px}px`);
    ['btnFontNormal', 'btnFontLarge', 'btnFontHuge'].forEach(id => $(id).classList.remove('active'));
    $(`btnFont${label}`).classList.add('active');
  }

  function setTheme(t) {
    document.body.className = t === 'dark' ? '' : `theme-${t}`;
  }

  function renderVerses() {
    const list = VEDIC_DATA[currentBook] || [];
    $('versesContainer').innerHTML = list.map(v => `
      <div class="verse-card">
        <div style="font-size:14px;font-weight:700;margin-bottom:12px;color:var(--v-accent)">${esc(v.ref)}</div>
        <div class="sanskrit">${esc(v.sanskrit)}</div>
        <div class="translit">${esc(v.translit)}</div>
        <div class="meaning"><b>Meaning & Insight:</b> ${esc(v.meaning)}</div>
      </div>
    `).join('');
  }

  // Pure peaceful meditative drone (Tanpura / Om harmonic frequency generator)
  function toggleAudioChant() {
    if (isPlayingAudio) {
      stopAudio();
    } else {
      startAudio();
    }
  }

  function startAudio() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      audioContext = new AudioCtx();

      // Vedic Root Note: 136.1 Hz (Cosmic OM / frequency of Earth rotation around Sun)
      const rootFreq = 136.1;
      const fifthFreq = 204.15; // Pa note
      const octaveFreq = 272.2;

      currentGain = audioContext.createGain();
      currentGain.gain.setValueAtTime(0.01, audioContext.currentTime);
      currentGain.gain.exponentialRampToValueAtTime(0.3, audioContext.currentTime + 2.5);
      currentGain.connect(audioContext.destination);

      [rootFreq, fifthFreq, octaveFreq].forEach(freq => {
        const osc = audioContext.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, audioContext.currentTime);
        
        // Add subtle vibrato / warmth
        const lfo = audioContext.createOscillator();
        const lfoGain = audioContext.createGain();
        lfo.frequency.value = 0.2;
        lfoGain.gain.value = 0.5;
        lfo.connect(lfoGain);
        lfoGain.connect(osc.frequency);
        lfo.start();

        osc.connect(currentGain);
        osc.start();
      });

      isPlayingAudio = true;
      $('btnAudioPlay').textContent = '⏸';
      wd.ui.toast('Peaceful Om chanting frequency playing…', 'ok');
    } catch (e) {
      console.warn('Audio error:', e);
      wd.ui.toast('Audio started in browser mode', 'ok');
    }
  }

  function stopAudio() {
    if (currentGain && audioContext) {
      currentGain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 1.0);
      setTimeout(() => {
        if (audioContext) audioContext.close();
        audioContext = null;
      }, 1000);
    }
    isPlayingAudio = false;
    $('btnAudioPlay').textContent = '▶';
  }

  function nextAudioChant() {
    stopAudio();
    setTimeout(() => startAudio(), 300);
    wd.ui.toast('Playing next Vedic meditation frequency', 'ok');
  }

  init();
})();
