(() => {
  const { atempo, audioCodec, parseTime } = window.FFKit;

  const X264 = (crf = '20') => ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf), '-pix_fmt', 'yuv420p'];
  const AAC = ['-c:a', 'aac', '-b:a', '160k'];
  const FAST = ['-movflags', '+faststart'];
  const even = 'scale=trunc(iw/2)*2:trunc(ih/2)*2';
  const audioOr = (info, args) => (info && info.hasAudio ? args : ['-an']);
  const cropTo = (a, b) => `crop=w='min(iw,ih*${a}/${b})':h='min(ih,iw*${b}/${a})'`;

  const QUALITY = [['high', 'High quality'], ['balanced', 'Balanced'], ['small', 'Smallest file']];
  const CRF = { high: 18, balanced: 23, small: 28 };
  const START = { id: 'start', label: 'Start (optional, e.g. 0:05)', type: 'time', value: '' };
  const LENGTH = { id: 'length', label: 'Length in seconds (optional)', type: 'number', value: '', min: 0 };
  const clip = (v) => [...(parseTime(v.start) ? ['-ss', String(parseTime(v.start))] : []), ...(+v.length > 0 ? ['-t', String(+v.length)] : [])];
  const clipDuration = (c) => (+c.v.length > 0 ? +c.v.length : Math.max(0, (c.info?.duration || 0) - (parseTime(c.v.start) || 0)));

  const tools = [
    // ------------------------------------------------------------- Convert
    {
      id: 'convert', group: 'Convert', name: 'Convert video', action: 'Convert',
      desc: 'Convert between MP4, MKV, MOV, AVI and WebM. MP4 plays everywhere.',
      fields: [
        { id: 'to', label: 'Convert to', type: 'select', options: [['mp4', 'MP4'], ['mkv', 'MKV'], ['mov', 'MOV'], ['avi', 'AVI'], ['webm', 'WebM']] },
        { id: 'q', label: 'Quality', type: 'select', options: QUALITY, value: 'balanced' },
      ],
      validate: (c) => (c.ext === c.v.to ? 'The video is already in this format.' : null),
      build: (c) => {
        const { to, q } = c.v;
        const p = c.file.path;
        let enc;
        if (to === 'webm') enc = ['-c:v', 'libvpx-vp9', '-crf', String({ high: 28, balanced: 33, small: 40 }[q]), '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4', ...audioOr(c.info, ['-c:a', 'libopus', '-b:a', '128k'])];
        else if (to === 'avi') enc = ['-c:v', 'mpeg4', '-q:v', String({ high: 2, balanced: 4, small: 7 }[q]), ...audioOr(c.info, ['-c:a', 'libmp3lame', '-b:a', '192k'])];
        else enc = [...X264(CRF[q]), ...audioOr(c.info, AAC), ...(to === 'mkv' ? [] : FAST)];
        return { args: ['-i', p, ...enc, c.out('converted', to)], duration: c.info.duration };
      },
    },
    {
      id: 'gif', group: 'Convert', name: 'Video to GIF', action: 'Make GIF',
      desc: 'Turn a clip into an animated GIF with an optimized color palette.',
      fields: [
        START, { ...LENGTH, value: '5', label: 'Length in seconds' },
        { id: 'fps', label: 'Frames per second', type: 'select', options: [['10', '10'], ['15', '15'], ['20', '20']], value: '15' },
        { id: 'w', label: 'Width', type: 'select', options: [['320', '320 px'], ['480', '480 px'], ['640', '640 px'], ['0', 'Original']], value: '480' },
      ],
      build: (c) => {
        const scale = c.v.w !== '0' ? `,scale=${c.v.w}:-1:flags=lanczos` : '';
        return {
          args: [...clip(c.v), '-i', c.file.path, '-vf', `fps=${c.v.fps}${scale},split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`, '-loop', '0', c.out('gif', 'gif')],
          duration: clipDuration(c),
        };
      },
    },
    {
      id: 'webp', group: 'Convert', name: 'Video to animated WebP', action: 'Convert',
      desc: 'Looping animated WebP: much smaller than GIF, works in modern browsers.',
      fields: [START, { ...LENGTH, value: '5', label: 'Length in seconds' },
        { id: 'w', label: 'Width', type: 'select', options: [['320', '320 px'], ['480', '480 px'], ['720', '720 px']], value: '480' }],
      build: (c) => ({ args: [...clip(c.v), '-i', c.file.path, '-vf', `fps=15,scale=${c.v.w}:-1`, '-c:v', 'libwebp', '-loop', '0', '-q:v', '70', '-an', c.out('animated', 'webp')], duration: clipDuration(c) }),
    },
    // --------------------------------------------------------------- Audio
    {
      id: 'audio', group: 'Audio', name: 'Extract audio', action: 'Extract',
      desc: 'Save the soundtrack as MP3, WAV, AAC, M4A, FLAC, OGG or Opus.',
      fields: [
        { id: 'to', label: 'Format', type: 'select', options: [['mp3', 'MP3'], ['m4a', 'M4A (AAC)'], ['aac', 'AAC'], ['wav', 'WAV (uncompressed)'], ['flac', 'FLAC (lossless)'], ['ogg', 'OGG Vorbis'], ['opus', 'Opus']] },
        { id: 'br', label: 'Bitrate', type: 'select', options: [['320k', '320 kbps'], ['192k', '192 kbps'], ['128k', '128 kbps']], value: '192k', show: (v) => !['wav', 'flac'].includes(v.to) },
      ],
      validate: (c) => (!c.info.hasAudio ? 'This video has no audio track.' : null),
      build: (c) => ({ args: ['-i', c.file.path, '-vn', ...audioCodec(c.v.to, c.v.br), c.out('audio', c.v.to)], duration: c.info.duration }),
    },
    {
      id: 'mute', group: 'Audio', name: 'Mute video', action: 'Remove audio',
      desc: 'Remove the audio track. The picture is copied without re-encoding (instant).',
      build: (c) => ({ args: ['-i', c.file.path, '-c:v', 'copy', '-an', c.out('muted')], duration: c.info.duration }),
    },
    {
      id: 'music', group: 'Audio', name: 'Add background music', input: 'video+audio', action: 'Add music',
      desc: 'Replace the soundtrack with music, or mix music under the original sound. Music loops to fit.',
      fields: [
        { id: 'mode', label: 'Mode', type: 'select', options: [['replace', 'Replace original audio'], ['mix', 'Mix with original audio']] },
        { id: 'vol', label: 'Music volume', type: 'range', min: 5, max: 200, step: 5, value: '60', format: (v) => v + '%' },
      ],
      validate: (c) => (c.v.mode === 'mix' && !c.info.hasAudio ? 'The video has no audio to mix with. Use "Replace".' : null),
      build: (c) => {
        const vol = (+c.v.vol / 100).toFixed(2);
        const outExt = ['mp4', 'mov', 'mkv'].includes(c.ext) ? c.ext : 'mkv';
        const inputs = ['-i', c.file.path, '-stream_loop', '-1', '-i', c.audio.path];
        const args = c.v.mode === 'replace'
          ? [...inputs, '-map', '0:v', '-map', '1:a', '-filter:a', `volume=${vol}`, '-c:v', 'copy', ...AAC, '-shortest', c.out('with music', outExt)]
          : [...inputs, '-filter_complex', `[1:a]volume=${vol}[m];[0:a][m]amix=inputs=2:duration=first:dropout_transition=0[a]`, '-map', '0:v', '-map', '[a]', '-c:v', 'copy', ...AAC, c.out('with music', outExt)];
        return { args, duration: c.info.duration };
      },
    },
    // ---------------------------------------------------------------- Edit
    {
      id: 'trim', group: 'Edit', name: 'Trim video', action: 'Trim',
      desc: 'Keep only the part between a start and end time (frame-accurate).',
      fields: [
        { id: 'start', label: 'Start (e.g. 0:30)', type: 'time', value: '0:00' },
        { id: 'end', label: 'End (e.g. 1:15)', type: 'time', value: '' },
      ],
      validate: (c) => {
        const s = parseTime(c.v.start) ?? 0, e = parseTime(c.v.end);
        if (e == null) return 'Enter an end time.';
        if (e <= s) return 'End must be after start.';
        if (c.info.duration && s >= c.info.duration) return 'Start is after the end of the video.';
        return null;
      },
      build: (c) => {
        const s = parseTime(c.v.start) ?? 0, e = parseTime(c.v.end);
        return { args: ['-i', c.file.path, '-ss', String(s), '-to', String(e), ...X264(), ...audioOr(c.info, AAC), ...FAST, c.out('trimmed', 'mp4')], duration: e - s };
      },
    },
    {
      id: 'crop', group: 'Edit', name: 'Crop video', action: 'Crop',
      desc: 'Crop to a common aspect ratio, centered: 9:16 for Reels/Shorts/TikTok, 1:1 for posts.',
      fields: [{ id: 'ratio', label: 'Aspect ratio', type: 'select', options: [['9:16', '9:16 vertical'], ['1:1', '1:1 square'], ['4:5', '4:5 portrait'], ['16:9', '16:9 widescreen'], ['4:3', '4:3']] }],
      build: (c) => {
        const [a, b] = c.v.ratio.split(':');
        return { args: ['-i', c.file.path, '-vf', `${cropTo(a, b)},${even}`, ...X264(), ...audioOr(c.info, AAC), ...FAST, c.out(c.v.ratio.replace(':', 'x'), 'mp4')], duration: c.info.duration };
      },
    },
    {
      id: 'resize', group: 'Edit', name: 'Resize video', action: 'Resize',
      desc: 'Scale to a standard height. Width follows the original aspect ratio.',
      fields: [{ id: 'h', label: 'Resolution', type: 'select', options: [['2160', '4K (2160p)'], ['1440', '1440p'], ['1080', '1080p'], ['720', '720p'], ['480', '480p'], ['360', '360p']], value: '720' }],
      build: (c) => ({ args: ['-i', c.file.path, '-vf', `scale=-2:${c.v.h}`, ...X264(), ...audioOr(c.info, AAC), ...FAST, c.out(c.v.h + 'p', 'mp4')], duration: c.info.duration }),
    },
    {
      id: 'rotate', group: 'Edit', name: 'Rotate / flip', action: 'Rotate',
      desc: 'Fix sideways phone videos or mirror the picture.',
      fields: [{ id: 'r', label: 'Rotation', type: 'select', options: [['transpose=1', '90° clockwise'], ['transpose=2', '90° counter-clockwise'], ['transpose=1,transpose=1', '180°'], ['hflip', 'Mirror horizontally'], ['vflip', 'Flip vertically']] }],
      build: (c) => ({ args: ['-i', c.file.path, '-vf', c.v.r, ...X264(), ...audioOr(c.info, AAC), ...FAST, c.out('rotated', 'mp4')], duration: c.info.duration }),
    },
    {
      id: 'speed', group: 'Edit', name: 'Change speed', action: 'Apply',
      desc: 'Speed up or slow down video and audio together (audio pitch is preserved).',
      fields: [{ id: 's', label: 'Speed', type: 'select', options: [['0.25', '0.25× (slow motion)'], ['0.5', '0.5×'], ['0.75', '0.75×'], ['1.25', '1.25×'], ['1.5', '1.5×'], ['2', '2×'], ['3', '3×'], ['4', '4×']], value: '2' }],
      build: (c) => {
        const s = +c.v.s;
        return {
          args: ['-i', c.file.path, '-filter:v', `setpts=PTS/${s}`, ...(c.info.hasAudio ? ['-filter:a', atempo(s), ...AAC] : ['-an']), ...X264(), ...FAST, c.out(s + 'x', 'mp4')],
          duration: c.info.duration / s,
        };
      },
    },
    {
      id: 'reverse', group: 'Edit', name: 'Reverse video', action: 'Reverse',
      desc: 'Play the clip backwards (audio too).',
      note: 'Reversing holds the whole clip in memory. Best for clips under about a minute.',
      build: (c) => ({ args: ['-i', c.file.path, '-vf', 'reverse', ...(c.info.hasAudio ? ['-af', 'areverse', ...AAC] : ['-an']), ...X264(), ...FAST, c.out('reversed', 'mp4')], duration: c.info.duration }),
    },
    {
      id: 'loop', group: 'Edit', name: 'Loop video', action: 'Loop',
      desc: 'Repeat the clip several times in one file (no re-encoding).',
      fields: [{ id: 'n', label: 'Total plays', type: 'select', options: [2, 3, 4, 5, 8, 10].map((n) => [String(n), n + '×']) }],
      build: (c) => ({ args: ['-stream_loop', String(+c.v.n - 1), '-i', c.file.path, '-c', 'copy', c.out(`loop x${c.v.n}`)], duration: c.info.duration * +c.v.n }),
    },
    {
      id: 'fps', group: 'Edit', name: 'Change frame rate', action: 'Convert',
      desc: 'Convert to a different frames-per-second rate.',
      fields: [{ id: 'fps', label: 'Frame rate', type: 'select', options: ['24', '25', '30', '50', '60'].map((n) => [n, n + ' fps']), value: '30' }],
      build: (c) => ({ args: ['-i', c.file.path, '-filter:v', `fps=${c.v.fps}`, ...X264(), ...audioOr(c.info, AAC), ...FAST, c.out(c.v.fps + 'fps', 'mp4')], duration: c.info.duration }),
    },
    {
      id: 'watermark', group: 'Edit', name: 'Add text watermark', action: 'Add watermark',
      desc: 'Burn a text watermark (e.g. your @handle) into the video.',
      fields: [
        { id: 'text', label: 'Text', type: 'text', value: '', placeholder: '@yourname' },
        { id: 'pos', label: 'Position', type: 'select', options: [['br', 'Bottom right'], ['bl', 'Bottom left'], ['tr', 'Top right'], ['tl', 'Top left'], ['c', 'Center']] },
        { id: 'size', label: 'Text size', type: 'range', min: 16, max: 120, step: 2, value: '36', format: (v) => v + ' px' },
        { id: 'opacity', label: 'Opacity', type: 'range', min: 10, max: 100, step: 5, value: '70', format: (v) => v + '%' },
      ],
      validate: (c) => (!String(c.v.text).trim() ? 'Enter the watermark text.' : null),
      build: (c) => {
        const font = c.platform === 'windows' ? 'C\\:/Windows/Fonts/arial.ttf'
          : c.platform === 'linux' ? '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
          : '/System/Library/Fonts/Supplemental/Arial.ttf';
        const text = String(c.v.text).replace(/[\\':%\n\r]/g, ' ').trim();
        const xy = { br: 'x=w-tw-24:y=h-th-24', bl: 'x=24:y=h-th-24', tr: 'x=w-tw-24:y=24', tl: 'x=24:y=24', c: 'x=(w-tw)/2:y=(h-th)/2' }[c.v.pos];
        const a = (+c.v.opacity / 100).toFixed(2);
        const vf = `drawtext=fontfile='${font}':text='${text}':fontsize=${c.v.size}:fontcolor=white@${a}:shadowcolor=black@${(a * 0.6).toFixed(2)}:shadowx=2:shadowy=2:${xy}`;
        return { args: ['-i', c.file.path, '-vf', vf, ...X264(), ...audioOr(c.info, AAC), ...FAST, c.out('watermarked', 'mp4')], duration: c.info.duration };
      },
    },
    {
      id: 'merge', group: 'Edit', name: 'Merge videos', input: 'many', action: 'Merge',
      desc: 'Join clips one after another into a single video. Different sizes are fitted with black bars.',
      fields: [
        { id: 'size', label: 'Output size', type: 'select', options: [['1920x1080', '1080p landscape'], ['1280x720', '720p landscape'], ['1080x1920', '1080×1920 vertical'], ['1080x1080', 'Square 1080']], value: '1280x720' },
      ],
      build: (c) => {
        const [W, H] = c.v.size.split('x');
        const args = [];
        c.files.forEach((f) => args.push('-i', f.path));
        // Clips without sound get a silent track so concat always has audio.
        let extra = c.files.length;
        const aLabels = c.infos.map((info, i) => {
          if (info.hasAudio) return `[${i}:a]`;
          args.push('-f', 'lavfi', '-t', String(info.duration || 1), '-i', 'anullsrc=r=48000:cl=stereo');
          return `[${extra++}:a]`;
        });
        const prep = c.files.map((_, i) =>
          `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v${i}];` +
          `${aLabels[i]}aresample=48000,aformat=channel_layouts=stereo[a${i}]`).join(';');
        const chain = c.files.map((_, i) => `[v${i}][a${i}]`).join('');
        args.push('-filter_complex', `${prep};${chain}concat=n=${c.files.length}:v=1:a=1[v][a]`, '-map', '[v]', '-map', '[a]', ...X264(), ...AAC, ...FAST, c.out('merged', 'mp4'));
        return { args, duration: c.infos.reduce((s, i) => s + (i.duration || 0), 0) };
      },
    },
    // ------------------------------------------------------------ Compress
    {
      id: 'compress', group: 'Compress', name: 'Compress video', action: 'Compress',
      desc: 'Make the file smaller while keeping it watchable.',
      fields: [
        { id: 'level', label: 'Compression', type: 'select', options: [['24', 'Light (best quality)'], ['28', 'Medium'], ['32', 'Strong (smallest)']], value: '28' },
        { id: 'h', label: 'Max resolution', type: 'select', options: [['0', 'Keep original'], ['1080', '1080p'], ['720', '720p'], ['480', '480p']], value: '0' },
      ],
      build: (c) => {
        const vf = c.v.h !== '0' && c.info.height > +c.v.h ? ['-vf', `scale=-2:${c.v.h}`] : [];
        return { args: ['-i', c.file.path, ...vf, '-c:v', 'libx264', '-preset', 'medium', '-crf', c.v.level, '-pix_fmt', 'yuv420p', ...audioOr(c.info, ['-c:a', 'aac', '-b:a', '128k']), ...FAST, c.out('compressed', 'mp4')], duration: c.info.duration };
      },
    },
    {
      id: 'tosize', group: 'Compress', name: 'Compress to file size', action: 'Compress',
      desc: 'Hit a target size, e.g. the 10 MB Discord limit or the 16 MB WhatsApp limit.',
      fields: [
        { id: 'mb', label: 'Target size', type: 'select', options: [['8', '8 MB'], ['10', '10 MB (Discord)'], ['16', '16 MB (WhatsApp)'], ['25', '25 MB (email)'], ['50', '50 MB'], ['100', '100 MB']], value: '10' },
      ],
      validate: (c) => {
        if (!c.info.duration) return 'Could not read the video length.';
        const kbps = (+c.v.mb * 8192 * 0.95) / c.info.duration - 96;
        return kbps < 80 ? 'This video is too long for that size. Pick a larger target or trim it first.' : null;
      },
      build: (c) => {
        const v = Math.floor((+c.v.mb * 8192 * 0.95) / c.info.duration - (c.info.hasAudio ? 96 : 0));
        const h = v < 600 ? 480 : v < 1500 ? 720 : 0;
        const vf = h && c.info.height > h ? ['-vf', `scale=-2:${h}`] : [];
        return {
          args: ['-i', c.file.path, ...vf, '-c:v', 'libx264', '-preset', 'medium', '-b:v', `${v}k`, '-maxrate', `${v}k`, '-bufsize', `${v * 2}k`, '-pix_fmt', 'yuv420p', ...audioOr(c.info, ['-c:a', 'aac', '-b:a', '96k']), ...FAST, c.out(`${c.v.mb}MB`, 'mp4')],
          duration: c.info.duration,
        };
      },
    },
    // ------------------------------------------------------------- Special
    {
      id: 'frames', group: 'Special', name: 'Extract frames', action: 'Extract',
      desc: 'Save still images from the video into a folder.',
      fields: [
        { id: 'every', label: 'Take a frame', type: 'select', options: [['1', 'Every second'], ['0.5', 'Every 2 seconds'], ['0.2', 'Every 5 seconds'], ['0.1', 'Every 10 seconds'], ['all', 'Every frame (many files!)']] },
        { id: 'fmt', label: 'Image format', type: 'select', options: [['jpg', 'JPG'], ['png', 'PNG']] },
      ],
      build: (c) => ({
        args: ['-i', c.file.path, ...(c.v.every === 'all' ? [] : ['-vf', `fps=${c.v.every}`]), ...(c.v.fmt === 'jpg' ? ['-q:v', '3'] : []), `frame_%05d.${c.v.fmt}`],
        duration: c.info.duration,
        subdir: `${c.stem} frames`,
      }),
    },
    {
      id: 'chroma', group: 'Special', name: 'Remove green screen', action: 'Remove background',
      desc: 'Make a green (or blue) screen background transparent. Output is a WebM with transparency.',
      fields: [
        { id: 'color', label: 'Screen color', type: 'select', options: [['00FF00', 'Green'], ['0000FF', 'Blue']] },
        { id: 'sim', label: 'Strength', type: 'range', min: 5, max: 40, step: 1, value: '15', format: (v) => (v / 100).toFixed(2) },
      ],
      build: (c) => ({
        args: ['-i', c.file.path, '-vf', `chromakey=0x${c.v.color}:${(+c.v.sim / 100).toFixed(2)}:0.08`, '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0', '-crf', '30', '-b:v', '0', '-row-mt', '1', ...audioOr(c.info, ['-c:a', 'libopus', '-b:a', '128k']), c.out('transparent', 'webm')],
        duration: c.info.duration,
      }),
    },
    {
      id: 'reels', group: 'Special', name: 'Reel / Shorts maker', action: 'Make clips',
      desc: 'Crop to vertical 9:16 at 1080×1920 and cut a long video into equal clips for Reels, Shorts or TikTok.',
      fields: [
        { id: 'len', label: 'Clip length', type: 'select', options: [['15', '15 s'], ['30', '30 s'], ['60', '60 s'], ['90', '90 s']], value: '60' },
        { id: 'crop', label: 'Framing', type: 'select', options: [['crop', 'Crop to fill (center)'], ['fit', 'Fit with blurred background']] },
      ],
      build: (c) => {
        const vf = c.v.crop === 'crop'
          ? `${cropTo(9, 16)},scale=1080:1920`
          : 'split[a][b];[a]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=20:5[bg];[b]scale=1080:1920:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2';
        return {
          args: ['-i', c.file.path, '-vf', vf, ...X264(21), ...audioOr(c.info, AAC), '-force_key_frames', `expr:gte(t,n_forced*${c.v.len})`, '-f', 'segment', '-segment_time', c.v.len, '-reset_timestamps', '1', 'clip_%02d.mp4'],
          duration: c.info.duration,
          subdir: `${c.stem} clips`,
        };
      },
    },
  ];

  window.FFKit.mount({ title: 'Video Toolkit', emoji: '🎬', subtitle: 'Convert · edit · compress · GIF · audio, powered by FFmpeg', tools });
})();
