(() => {
  const { atempo, audioCodec, parseTime } = window.FFKit;
  const FORMATS = [['mp3', 'MP3'], ['m4a', 'M4A (AAC)'], ['aac', 'AAC'], ['wav', 'WAV (uncompressed)'], ['flac', 'FLAC (lossless)'], ['ogg', 'OGG Vorbis'], ['opus', 'Opus']];
  const BITRATES = [['320k', '320 kbps'], ['256k', '256 kbps'], ['192k', '192 kbps'], ['128k', '128 kbps'], ['96k', '96 kbps'], ['64k', '64 kbps']];
  const lossless = (f) => ['wav', 'flac'].includes(f);
  const FMT = { id: 'to', label: 'Output format', type: 'select', options: FORMATS };
  const BR = { id: 'br', label: 'Bitrate', type: 'select', options: BITRATES, value: '192k', show: (v) => !lossless(v.to) };
  /** Keep the input's format for edit tools unless it can't be re-encoded directly. */
  const sameFormat = (c) => (FORMATS.some(([f]) => f === c.ext) ? c.ext : 'mp3');
  const noAudio = (c) => (!c.info.hasAudio ? 'No audio stream found in this file.' : null);

  const tools = [
    {
      id: 'convert', group: 'Convert', name: 'Convert audio', action: 'Convert',
      desc: 'Any audio file to MP3, M4A, AAC, WAV, FLAC, OGG or Opus.',
      fields: [FMT, BR],
      validate: (c) => noAudio(c) || (c.ext === c.v.to ? 'The file is already in this format. Use "Compress" to change the bitrate.' : null),
      build: (c) => ({ args: ['-i', c.file.path, '-vn', '-map_metadata', '0', ...audioCodec(c.v.to, c.v.br), c.out('converted', c.v.to)], duration: c.info.duration }),
    },
    {
      id: 'compress', group: 'Convert', name: 'Compress audio', action: 'Compress',
      desc: 'Re-encode at a lower bitrate to save space (output keeps the same format, or MP3 for lossless input).',
      fields: [{ id: 'br', label: 'Quality', type: 'select', options: [['192k', 'High (192 kbps)'], ['128k', 'Standard (128 kbps)'], ['96k', 'Small (96 kbps)'], ['64k', 'Voice (64 kbps)']], value: '128k' }],
      validate: noAudio,
      build: (c) => {
        const to = lossless(c.ext) || !FORMATS.some(([f]) => f === c.ext) ? 'mp3' : c.ext;
        return { args: ['-i', c.file.path, '-vn', '-map_metadata', '0', ...audioCodec(to, c.v.br), c.out(c.v.br, to)], duration: c.info.duration };
      },
    },
    {
      id: 'trim', group: 'Edit', name: 'Trim audio', action: 'Trim',
      desc: 'Cut out a section, e.g. to make a ringtone.',
      fields: [{ id: 'start', label: 'Start (e.g. 0:30)', type: 'time', value: '0:00' }, { id: 'end', label: 'End (e.g. 1:00)', type: 'time', value: '' },
        { id: 'fade', label: 'Fade in/out', type: 'select', options: [['0', 'None'], ['1', '1 second'], ['3', '3 seconds']] }],
      validate: (c) => {
        const s = parseTime(c.v.start) ?? 0, e = parseTime(c.v.end);
        if (e == null) return 'Enter an end time.';
        return e <= s ? 'End must be after start.' : noAudio(c);
      },
      build: (c) => {
        const s = parseTime(c.v.start) ?? 0, e = parseTime(c.v.end), d = e - s, f = +c.v.fade;
        const af = f ? ['-af', `afade=t=in:st=0:d=${f},afade=t=out:st=${Math.max(0, d - f)}:d=${f}`] : [];
        const to = sameFormat(c);
        return { args: ['-ss', String(s), '-t', String(d), '-i', c.file.path, '-vn', ...af, ...audioCodec(to, '192k'), c.out('trimmed', to)], duration: d };
      },
    },
    {
      id: 'normalize', group: 'Edit', name: 'Normalize volume', action: 'Normalize',
      desc: 'Even out loudness to a standard level (EBU R128), handy for podcasts and mixed playlists.',
      fields: [{ id: 'target', label: 'Target loudness', type: 'select', options: [['-14', 'Streaming (−14 LUFS)'], ['-16', 'Podcast (−16 LUFS)'], ['-23', 'Broadcast (−23 LUFS)']], value: '-16' }],
      validate: noAudio,
      build: (c) => {
        const to = sameFormat(c);
        return { args: ['-i', c.file.path, '-vn', '-af', `loudnorm=I=${c.v.target}:TP=-1.5:LRA=11`, '-ar', '48000', ...audioCodec(to, '192k'), c.out('normalized', to)], duration: c.info.duration };
      },
    },
    {
      id: 'volume', group: 'Edit', name: 'Change volume', action: 'Apply',
      desc: 'Make the audio louder or quieter.',
      fields: [{ id: 'vol', label: 'Volume', type: 'range', min: 10, max: 400, step: 10, value: '150', format: (v) => v + '%' }],
      validate: noAudio,
      build: (c) => {
        const to = sameFormat(c);
        return { args: ['-i', c.file.path, '-vn', '-af', `volume=${(+c.v.vol / 100).toFixed(2)}`, ...audioCodec(to, '192k'), c.out(c.v.vol + '%', to)], duration: c.info.duration };
      },
    },
    {
      id: 'speed', group: 'Edit', name: 'Change speed', action: 'Apply',
      desc: 'Speed up or slow down without changing pitch.',
      fields: [{ id: 's', label: 'Speed', type: 'select', options: [['0.5', '0.5×'], ['0.75', '0.75×'], ['1.25', '1.25×'], ['1.5', '1.5×'], ['2', '2×']], value: '1.25' }],
      validate: noAudio,
      build: (c) => {
        const to = sameFormat(c);
        return { args: ['-i', c.file.path, '-vn', '-af', atempo(+c.v.s), ...audioCodec(to, '192k'), c.out(c.v.s + 'x', to)], duration: c.info.duration / +c.v.s };
      },
    },
    {
      id: 'reverse', group: 'Edit', name: 'Reverse audio', action: 'Reverse',
      desc: 'Play the audio backwards.',
      validate: noAudio,
      build: (c) => {
        const to = sameFormat(c);
        return { args: ['-i', c.file.path, '-vn', '-af', 'areverse', ...audioCodec(to, '192k'), c.out('reversed', to)], duration: c.info.duration };
      },
    },
    {
      id: 'merge', group: 'Edit', name: 'Join audio files', input: 'many', action: 'Join',
      desc: 'Combine tracks one after another into a single file.',
      fields: [FMT, BR],
      validate: (c) => (c.infos.some((i) => !i.hasAudio) ? 'One of the files has no audio.' : null),
      build: (c) => {
        const args = [];
        c.files.forEach((f) => args.push('-i', f.path));
        const prep = c.files.map((_, i) => `[${i}:a]aresample=48000,aformat=channel_layouts=stereo[a${i}]`).join(';');
        const chain = c.files.map((_, i) => `[a${i}]`).join('');
        args.push('-filter_complex', `${prep};${chain}concat=n=${c.files.length}:v=0:a=1[a]`, '-map', '[a]', ...audioCodec(c.v.to, c.v.br), c.out('joined', c.v.to));
        return { args, duration: c.infos.reduce((s, i) => s + (i.duration || 0), 0) };
      },
    },
  ];

  window.FFKit.mount({ title: 'Audio Converter', emoji: '🎧', subtitle: 'MP3 · WAV · FLAC · AAC · OGG · Opus, powered by FFmpeg', pickType: 'audio', tools });
})();
