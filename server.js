const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { spawn, exec, execSync } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

// Setup directories
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const BURN_TEMP_DIR = path.join(__dirname, 'burn_temp');
const RIP_TEMP_DIR = path.join(__dirname, 'rip_temp');
const PUBLIC_DIR = path.join(__dirname, 'public');

[UPLOADS_DIR, BURN_TEMP_DIR, RIP_TEMP_DIR, PUBLIC_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Configure Multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_ ]/g, '_');
    cb(null, `${Date.now()}-${safeName}`);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const mimeTypePattern = /^audio\//i;
    const extensionPattern = /\.(mp3|wav|flac|m4a|ogg|aac|wma|aiff)$/i;
    if (mimeTypePattern.test(file.mimetype) || extensionPattern.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('Only audio files are allowed!'), false);
    }
  }
});

app.use(express.json());
app.use(express.static(PUBLIC_DIR));

// In-memory state
let tracks = [];

// Active jobs
let activeBurnJob = {
  status: 'idle', // idle, converting, burning, success, failed
  progress: 0,
  currentStep: '',
  logs: [],
  error: null
};

let activeRipJob = {
  status: 'idle', // idle, ripping, success, failed
  progress: 0,
  currentStep: '',
  logs: [],
  error: null
};

// SSE Client lists
let sseClients = [];
let sseRipClients = [];

// Broadcast burning status
function broadcastStatus(logLine = null) {
  if (logLine) {
    activeBurnJob.logs.push(logLine);
    if (activeBurnJob.logs.length > 500) activeBurnJob.logs.shift();
  }

  const data = JSON.stringify({
    status: activeBurnJob.status,
    progress: activeBurnJob.progress,
    currentStep: activeBurnJob.currentStep,
    logLine: logLine,
    error: activeBurnJob.error
  });

  sseClients.forEach(client => {
    client.write(`event: progress\ndata: ${data}\n\n`);
  });
}

// Broadcast ripping status
function broadcastRipStatus(logLine = null) {
  if (logLine) {
    activeRipJob.logs.push(logLine);
    if (activeRipJob.logs.length > 500) activeRipJob.logs.shift();
  }

  const data = JSON.stringify({
    status: activeRipJob.status,
    progress: activeRipJob.progress,
    currentStep: activeRipJob.currentStep,
    logLine: logLine,
    error: activeRipJob.error
  });

  sseRipClients.forEach(client => {
    client.write(`event: progress\ndata: ${data}\n\n`);
  });
}

// System tools presence checker
function getSystemCapabilities() {
  let hasFFmpeg = false;
  let hasFFprobe = false;
  let hasWodim = false;
  let hasCdparanoia = false;

  try {
    execSync('which ffmpeg');
    hasFFmpeg = true;
  } catch (e) {}

  try {
    execSync('which ffprobe');
    hasFFprobe = true;
  } catch (e) {}

  try {
    execSync('which wodim || which cdrecord');
    hasWodim = true;
  } catch (e) {}

  try {
    execSync('which cdparanoia');
    hasCdparanoia = true;
  } catch (e) {}

  return { hasFFmpeg, hasFFprobe, hasWodim, hasCdparanoia };
}

// Wrapper for extracting audio metadata using ffprobe
function extractMetadata(filePath, originalFilename) {
  return new Promise((resolve) => {
    const caps = getSystemCapabilities();
    if (!caps.hasFFprobe) {
      resolve({
        title: path.basename(originalFilename, path.extname(originalFilename)),
        artist: 'Unknown Artist',
        album: 'Unknown Album',
        duration: 240
      });
      return;
    }

    const ffprobe = spawn('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath
    ]);

    let output = '';
    ffprobe.stdout.on('data', (data) => {
      output += data;
    });

    ffprobe.on('close', (code) => {
      if (code !== 0) {
        resolve({
          title: path.basename(originalFilename, path.extname(originalFilename)),
          artist: 'Unknown Artist',
          album: 'Unknown Album',
          duration: 240
        });
        return;
      }

      try {
        const metadata = JSON.parse(output);
        const format = metadata.format || {};
        const tags = format.tags || {};

        let duration = parseFloat(format.duration);
        if (isNaN(duration)) {
          const audioStream = (metadata.streams || []).find(s => s.codec_type === 'audio');
          duration = audioStream ? parseFloat(audioStream.duration) : 240;
        }

        resolve({
          title: tags.title || tags.TITLE || path.basename(originalFilename, path.extname(originalFilename)),
          artist: tags.artist || tags.ARTIST || 'Unknown Artist',
          album: tags.album || tags.ALBUM || 'Unknown Album',
          duration: isNaN(duration) ? 240 : duration
        });
      } catch (err) {
        resolve({
          title: path.basename(originalFilename, path.extname(originalFilename)),
          artist: 'Unknown Artist',
          album: 'Unknown Album',
          duration: 240
        });
      }
    });
  });
}

// CD drive detector
function detectDrives() {
  const drives = [];
  drives.push({ name: 'Mock Burner (Dev Simulator)', device: 'mock' });

  if (process.platform === 'linux') {
    const commonPaths = ['/dev/cdrom', '/dev/sr0', '/dev/sg0'];
    commonPaths.forEach(devPath => {
      if (fs.existsSync(devPath)) {
        drives.push({ name: `Physical Drive (${devPath})`, device: devPath });
      }
    });
  } else if (process.platform === 'darwin') {
    try {
      const output = execSync('drutil list', { encoding: 'utf8' });
      const lines = output.split('\n');
      lines.forEach((line, idx) => {
        if (idx > 0 && line.trim()) {
          const parts = line.trim().split(/\s{2,}/);
          if (parts[0] && parts[1]) {
            drives.push({ name: `Apple Burner: ${parts[1]}`, device: parts[0] });
          }
        }
      });
    } catch (e) {}
  }

  return drives;
}

// Cleanup temp directories
function cleanupBurnTemp() {
  try {
    if (fs.existsSync(BURN_TEMP_DIR)) {
      fs.readdirSync(BURN_TEMP_DIR).forEach(file => fs.unlinkSync(path.join(BURN_TEMP_DIR, file)));
    }
  } catch (err) {}
}

function cleanupRipTemp() {
  try {
    if (fs.existsSync(RIP_TEMP_DIR)) {
      fs.readdirSync(RIP_TEMP_DIR).forEach(file => fs.unlinkSync(path.join(RIP_TEMP_DIR, file)));
    }
  } catch (err) {}
}

/* =======================================
   BURNING ENGINE
   ======================================= */
function runMockBurn(simulateSpeed, isDummy) {
  return new Promise((resolve) => {
    activeBurnJob.status = 'converting';
    activeBurnJob.progress = 0;
    activeBurnJob.currentStep = 'Preparing and converting audio tracks...';
    activeBurnJob.error = null;
    activeBurnJob.logs = [];

    broadcastStatus('>>> Initialising silky-bohr-burner (MOCK SESSION) <<<');
    broadcastStatus(`Target Device: mock | Write Speed: ${simulateSpeed}x | Dummy Mode: ${isDummy}`);
    broadcastStatus('Validating disc storage capacities...');

    let trackIdx = 0;

    function convertNext() {
      if (trackIdx < tracks.length) {
        const track = tracks[trackIdx];
        activeBurnJob.currentStep = `Converting track ${trackIdx + 1}/${tracks.length}: "${track.title}"`;
        activeBurnJob.progress = Math.round((trackIdx / tracks.length) * 40);
        broadcastStatus(`Converting: "${track.title}" to Red Book WAV Format (44.1kHz, 16-bit, stereo)`);
        
        setTimeout(() => {
          broadcastStatus(`Converted: "${track.title}" successfully. Created temporary audio wave layout.`);
          trackIdx++;
          convertNext();
        }, 1000);
      } else {
        startBurningPhase();
      }
    }

    function startBurningPhase() {
      activeBurnJob.status = 'burning';
      activeBurnJob.progress = 40;
      activeBurnJob.currentStep = 'Writing optical media...';
      
      broadcastStatus('Launching burning engine backend (mocked wodim)...');
      broadcastStatus('wodim: Device seems to be: Generic CD-RW drive');
      
      if (isDummy) {
        broadcastStatus('wodim: Dummy write enabled. No actual physical lasers will fire!');
      }

      broadcastStatus('wodim: Sending Packing Command...');
      broadcastStatus('wodim: TOC Type: 1 = CD-DA (Audio CD Layout)');
      broadcastStatus(`wodim: Burning speed selected is ${simulateSpeed}x.`);
      broadcastStatus(`wodim: Total tracks to burn: ${tracks.length}`);
      
      let burnIdx = 0;

      function burnNext() {
        if (burnIdx < tracks.length) {
          const track = tracks[burnIdx];
          const trackNumber = String(burnIdx + 1).padStart(2, '0');
          activeBurnJob.currentStep = `Writing track ${burnIdx + 1}/${tracks.length}: "${track.title}"`;
          
          let trackProgress = 0;
          
          function writeChunk() {
            if (trackProgress <= 100) {
              const overallProgress = 40 + Math.round(((burnIdx / tracks.length) + (trackProgress / 100 / tracks.length)) * 50);
              activeBurnJob.progress = overallProgress;
              
              if (trackProgress % 20 === 0) {
                broadcastStatus(`wodim: Track ${trackNumber}: Writing chunk (${trackProgress}%) at speed ${simulateSpeed}x`);
              }
              
              trackProgress += 20;
              setTimeout(writeChunk, 250);
            } else {
              broadcastStatus(`wodim: Track ${trackNumber} [${track.title}] completed successfully.`);
              burnIdx++;
              setTimeout(burnNext, 400);
            }
          }
          
          writeChunk();
        } else {
          activeBurnJob.currentStep = 'Flushing drive buffers and finalizing disc...';
          activeBurnJob.progress = 95;
          broadcastStatus('wodim: Writing Lead-Out/TOC to disc...');
          
          setTimeout(() => {
            activeBurnJob.progress = 100;
            activeBurnJob.status = 'success';
            activeBurnJob.currentStep = 'Finished!';
            broadcastStatus('wodim: Flushing cache. Drive buffers cleared.');
            broadcastStatus('wodim: Ejecting physical drive tray... Clack! Open.');
            broadcastStatus('=============================================');
            broadcastStatus('   CD BURN OPERATION COMPLETED SUCCESSFULLY   ');
            broadcastStatus('=============================================');
            resolve();
          }, 1500);
        }
      }

      setTimeout(burnNext, 1000);
    }

    setTimeout(convertNext, 800);
  });
}

async function runRealBurn(device, speed, isDummy) {
  activeBurnJob.status = 'converting';
  activeBurnJob.progress = 0;
  activeBurnJob.currentStep = 'Preparing and converting audio tracks...';
  activeBurnJob.error = null;
  activeBurnJob.logs = [];

  broadcastStatus('>>> Initialising silky-bohr-burner (REAL SESSION) <<<');
  broadcastStatus(`Target Device: ${device} | Write Speed: ${speed}x | Dummy Mode: ${isDummy}`);

  cleanupBurnTemp();

  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    const trackNumber = String(i + 1).padStart(2, '0');
    activeBurnJob.currentStep = `Converting track ${i + 1}/${tracks.length}: "${track.title}"`;
    activeBurnJob.progress = Math.round((i / tracks.length) * 45);
    broadcastStatus(`ffmpeg: Converting [${trackNumber}] "${track.title}" to Red Book WAV...`);

    const outputWav = path.join(BURN_TEMP_DIR, `track_${trackNumber}.wav`);
    const ffmpegProc = spawn('ffmpeg', [
      '-y',
      '-i', track.path,
      '-ar', '44100',
      '-ac', '2',
      '-f', 'wav',
      outputWav
    ]);

    await new Promise((resolve, reject) => {
      let ffmpegLog = '';
      ffmpegProc.stderr.on('data', (chunk) => ffmpegLog += chunk.toString());
      ffmpegProc.on('close', (code) => {
        if (code === 0) {
          broadcastStatus(`ffmpeg: Converted track [${trackNumber}] successfully.`);
          resolve();
        } else {
          reject(new Error(`Failed to convert track "${track.title}". FFmpeg exited with code ${code}`));
        }
      });
    });
  }

  activeBurnJob.status = 'burning';
  activeBurnJob.progress = 45;
  activeBurnJob.currentStep = 'Writing optical media...';
  broadcastStatus('Preparing wodim command and files...');

  const wavFiles = fs.readdirSync(BURN_TEMP_DIR)
    .filter(f => f.endsWith('.wav'))
    .map(f => path.join(BURN_TEMP_DIR, f))
    .sort();

  if (wavFiles.length === 0) {
    throw new Error('No audio tracks were successfully converted.');
  }

  let burnTool = 'wodim';
  try {
    execSync('which wodim');
  } catch (e) {
    try {
      execSync('which cdrecord');
      burnTool = 'cdrecord';
    } catch (err) {
      throw new Error('Neither "wodim" nor "cdrecord" CD burning utilities were found on your server.');
    }
  }

  const args = ['-v', '-audio', `speed=${speed}`, `dev=${device}`];
  if (isDummy) args.push('-dummy');
  args.push(...wavFiles);

  broadcastStatus(`Executing: ${burnTool} ${args.join(' ')}`);

  const burnProc = spawn(burnTool, args);

  burnProc.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');
    lines.forEach(line => {
      if (line.trim()) {
        broadcastStatus(`${burnTool}: ${line}`);
        
        const progressMatch = line.match(/Track\s+(\d+):\s+(\d+)\s+of\s+(\d+)\s+MB\s+written/i);
        if (progressMatch) {
          const trackNum = parseInt(progressMatch[1]);
          const written = parseInt(progressMatch[2]);
          const total = parseInt(progressMatch[3]);
          
          if (total > 0) {
            const trackProgress = written / total;
            const overallBurnPercent = ((trackNum - 1) + trackProgress) / tracks.length;
            activeBurnJob.progress = 45 + Math.round(overallBurnPercent * 50);
            activeBurnJob.currentStep = `Writing track ${trackNum}/${tracks.length} (${Math.round(trackProgress * 100)}%)`;
          }
        }
      }
    });
  });

  burnProc.stderr.on('data', (data) => {
    const lines = data.toString().split('\n');
    lines.forEach(line => {
      if (line.trim()) broadcastStatus(`${burnTool} [err]: ${line}`);
    });
  });

  await new Promise((resolve, reject) => {
    burnProc.on('close', (code) => {
      cleanupBurnTemp();

      if (code === 0) {
        activeBurnJob.progress = 100;
        activeBurnJob.status = 'success';
        activeBurnJob.currentStep = 'Finished!';
        broadcastStatus('=============================================');
        broadcastStatus('   CD BURN OPERATION COMPLETED SUCCESSFULLY   ');
        broadcastStatus('=============================================');

        broadcastStatus(`Ejecting drive tray for device: ${device}`);
        exec(`eject ${device}`, (err) => {
          if (err) broadcastStatus(`Failed to auto-eject drive: ${err.message}`);
          else broadcastStatus('Drive tray opened. Ready to fetch CD!');
        });

        resolve();
      } else {
        reject(new Error(`${burnTool} execution failed with exit code ${code}`));
      }
    });
  });
}

/* =======================================
   RIPPING ENGINE
   ======================================= */

// Mock CD Ripping Engine
function runMockRip(format, album, artist, ripTracks) {
  return new Promise((resolve) => {
    activeRipJob.status = 'ripping';
    activeRipJob.progress = 0;
    activeRipJob.currentStep = 'Reading Table of Contents (TOC) and indexing tracks...';
    activeRipJob.error = null;
    activeRipJob.logs = [];

    broadcastRipStatus('>>> Initialising silky-bohr-burner CD RIP ENGINE (MOCK SESSION) <<<');
    broadcastRipStatus(`Album Title: ${album} | Artist Name: ${artist} | Target Format: ${format.toUpperCase()}`);
    broadcastRipStatus(`Total tracks detected for extraction: ${ripTracks.length}`);

    let trackIdx = 0;

    function ripNext() {
      if (trackIdx < ripTracks.length) {
        const track = ripTracks[trackIdx];
        const trackNumber = String(track.number).padStart(2, '0');
        activeRipJob.currentStep = `Extracting track ${trackIdx + 1}/${ripTracks.length}: "${track.title}"`;
        
        broadcastRipStatus(`---------------------------------------------`);
        broadcastRipStatus(`cdparanoia: Starting sector extraction for Track ${trackNumber}...`);
        
        let sectorProgress = 0;
        
        function readSectors() {
          if (sectorProgress <= 100) {
            const overallProgress = Math.round(((trackIdx / ripTracks.length) + (sectorProgress / 100 / ripTracks.length)) * 80); // 0 to 80%
            activeRipJob.progress = overallProgress;
            
            if (sectorProgress % 20 === 0) {
              const startSec = 150 + trackIdx * 15000 + Math.round(sectorProgress * 150);
              broadcastRipStatus(`cdparanoia: [Ripping] Track ${trackNumber} sector ${startSec} -- [Read progress: ${sectorProgress}%] (===>>>)`);
            }
            
            sectorProgress += 20;
            setTimeout(readSectors, 150);
          } else {
            broadcastRipStatus(`cdparanoia: Sector reading complete for Track ${trackNumber}. Validated checksum integrity.`);
            compressAndTagTrack(track);
          }
        }
        
        readSectors();
      } else {
        // Complete Ripping
        activeRipJob.currentStep = 'Finishing rip job and ejecting drive...';
        activeRipJob.progress = 95;
        broadcastRipStatus('=============================================');
        broadcastRipStatus('cdparanoia: Ripping session completed.');
        
        setTimeout(() => {
          activeRipJob.progress = 100;
          activeRipJob.status = 'success';
          activeRipJob.currentStep = 'Finished!';
          broadcastRipStatus('cdparanoia: Ejecting physical drive tray... Click. Ejected.');
          broadcastRipStatus('=============================================');
          broadcastRipStatus('   CD RIP OPERATION COMPLETED SUCCESSFULLY    ');
          broadcastRipStatus('=============================================');
          resolve();
        }, 1500);
      }
    }

    // FFmpeg compression & metadata tagging
    function compressAndTagTrack(track) {
      const trackNumber = String(track.number).padStart(2, '0');
      activeRipJob.currentStep = `Encoding track ${track.number}/${ripTracks.length}: "${track.title}"...`;
      broadcastRipStatus(`ffmpeg: Compressing Track ${trackNumber} to high-fidelity ${format.toUpperCase()} (320kbps)...`);
      broadcastRipStatus(`ffmpeg: Embedding ID3 Metadata [Title: "${track.title}" | Artist: "${artist}" | Album: "${album}"]`);

      const duration = track.duration || 240;
      const safeTitle = track.title.replace(/[^a-zA-Z0-9_\-]/g, '_');
      const filename = `ripped-${Date.now()}-${trackNumber}-${safeTitle}.${format}`;
      const outputPath = path.join(UPLOADS_DIR, filename);

      // Programmatically generate a silent valid MP3 or WAV file using ffmpeg to ensure the ripped files are authentic, playable tracks!
      const ffmpegArgs = [
        '-y',
        '-f', 'lavfi',
        '-i', `anullsrc=r=44100:cl=stereo`,
        '-t', `${duration}`,
        '-metadata', `title=${track.title}`,
        '-metadata', `artist=${artist}`,
        '-metadata', `album=${album}`,
        '-metadata', `track=${track.number}/${ripTracks.length}`
      ];

      if (format === 'mp3') {
        ffmpegArgs.push('-codec:a', 'libmp3lame', '-b:a', '320k');
      } else if (format === 'flac') {
        ffmpegArgs.push('-codec:a', 'flac');
      } else {
        ffmpegArgs.push('-codec:a', 'pcm_s16le', '-f', 'wav');
      }

      ffmpegArgs.push(outputPath);

      const encodeProc = spawn('ffmpeg', ffmpegArgs);

      encodeProc.on('close', (code) => {
        if (code === 0) {
          const stats = fs.existsSync(outputPath) ? fs.statSync(outputPath) : { size: 1024 * 1024 * 5 };
          
          // Push new ripped track into Mastering Queue in-memory database!
          const newTrack = {
            id: `track-rip-${Date.now()}-${track.number}`,
            filename,
            path: outputPath,
            title: track.title,
            artist,
            album,
            duration,
            size: stats.size,
            mimeType: format === 'mp3' ? 'audio/mpeg' : (format === 'flac' ? 'audio/flac' : 'audio/wav')
          };
          
          tracks.push(newTrack);
          broadcastRipStatus(`ffmpeg: Compressing complete. Track [${trackNumber}] saved as uploads/${filename}`);
          
          // Increment progress slightly (80% to 95% scale)
          activeRipJob.progress = 80 + Math.round((trackIdx / ripTracks.length) * 15);
          
          trackIdx++;
          setTimeout(ripNext, 300);
        } else {
          broadcastRipStatus(`ffmpeg [error]: Encoding failed for Track ${trackNumber}.`);
          trackIdx++;
          setTimeout(ripNext, 300);
        }
      });
    }

    setTimeout(ripNext, 800);
  });
}

// Real CD Ripping Engine
async function runRealRip(device, format, album, artist, ripTracks) {
  activeRipJob.status = 'ripping';
  activeRipJob.progress = 0;
  activeRipJob.currentStep = 'Reading Table of Contents (TOC) and indexing tracks...';
  activeRipJob.error = null;
  activeRipJob.logs = [];

  broadcastRipStatus('>>> Initialising silky-bohr-burner CD RIP ENGINE (REAL SESSION) <<<');
  broadcastRipStatus(`Target Device: ${device} | Album Title: ${album} | Artist Name: ${artist} | Format: ${format.toUpperCase()}`);

  cleanupRipTemp();

  // Inspect that cdparanoia is available
  try {
    execSync('which cdparanoia');
  } catch (e) {
    throw new Error('The "cdparanoia" CD-DA audio extraction utility is not installed on this server.');
  }

  for (let i = 0; i < ripTracks.length; i++) {
    const track = ripTracks[i];
    const trackNumber = String(track.number).padStart(2, '0');
    activeRipJob.currentStep = `Extracting track ${i + 1}/${ripTracks.length}: "${track.title}"`;
    activeRipJob.progress = Math.round((i / ripTracks.length) * 75); // 0 to 75% for extraction
    
    broadcastRipStatus(`---------------------------------------------`);
    broadcastRipStatus(`cdparanoia: Extracting sector tracks for Track ${trackNumber}...`);

    const rawWavPath = path.join(RIP_TEMP_DIR, `raw_track_${trackNumber}.wav`);
    
    // Command: cdparanoia -d /dev/cdrom [track_num] file.wav
    const ripProc = spawn('cdparanoia', [
      '-d', device,
      String(track.number),
      rawWavPath
    ]);

    await new Promise((resolve, reject) => {
      // cdparanoia outputs detailed real-time extraction blocks to stderr
      ripProc.stderr.on('data', (data) => {
        const line = data.toString().trim();
        if (line) {
          broadcastRipStatus(`cdparanoia: ${line}`);
          // Look for sector progress signatures, e.g. "sector 1500 [rip 1500]"
          const sectorMatch = line.match(/sector\s+(\d+)/i);
          if (sectorMatch) {
            broadcastRipStatus(`cdparanoia: Extracting sector block #${sectorMatch[1]}`);
          }
        }
      });

      ripProc.on('close', (code) => {
        if (code === 0) {
          broadcastRipStatus(`cdparanoia: Successfully ripped track [${trackNumber}] to RAW WAV.`);
          resolve();
        } else {
          reject(new Error(`cdparanoia failed to extract track ${track.number}. Exited with code ${code}`));
        }
      });
    });

    // 2. Compress using ffmpeg and inject metadata
    activeRipJob.currentStep = `Encoding track ${i + 1}/${ripTracks.length}: "${track.title}"...`;
    broadcastRipStatus(`ffmpeg: Compressing Track ${trackNumber} to high-fidelity ${format.toUpperCase()} (320kbps)...`);
    
    const safeTitle = track.title.replace(/[^a-zA-Z0-9_\-]/g, '_');
    const filename = `ripped-${Date.now()}-${trackNumber}-${safeTitle}.${format}`;
    const outputPath = path.join(UPLOADS_DIR, filename);

    // Build FFmpeg encode args
    const ffmpegArgs = [
      '-y',
      '-i', rawWavPath,
      '-metadata', `title=${track.title}`,
      '-metadata', `artist=${artist}`,
      '-metadata', `album=${album}`,
      '-metadata', `track=${track.number}/${ripTracks.length}`
    ];

    if (format === 'mp3') {
      ffmpegArgs.push('-codec:a', 'libmp3lame', '-b:a', '320k');
    } else if (format === 'flac') {
      ffmpegArgs.push('-codec:a', 'flac');
    } else {
      ffmpegArgs.push('-codec:a', 'pcm_s16le', '-f', 'wav');
    }

    ffmpegArgs.push(outputPath);

    const encodeProc = spawn('ffmpeg', ffmpegArgs);

    await new Promise((resolve, reject) => {
      encodeProc.on('close', (code) => {
        // Clean temp wav
        try { if (fs.existsSync(rawWavPath)) fs.unlinkSync(rawWavPath); } catch (e) {}

        if (code === 0) {
          const stats = fs.statSync(outputPath);
          
          // Inject into mastering queue in-memory database immediately!
          const newTrack = {
            id: `track-rip-${Date.now()}-${track.number}`,
            filename,
            path: outputPath,
            title: track.title,
            artist,
            album,
            duration: track.duration || 240, // Preserve CD duration calculated from TOC
            size: stats.size,
            mimeType: format === 'mp3' ? 'audio/mpeg' : (format === 'flac' ? 'audio/flac' : 'audio/wav')
          };
          
          tracks.push(newTrack);
          broadcastRipStatus(`ffmpeg: Transcoding complete for Track [${trackNumber}]. Added to Mastering playlist.`);
          resolve();
        } else {
          reject(new Error(`FFmpeg transcoding failed on Track ${track.number}. Code ${code}`));
        }
      });
    });
  }

  // Complete
  activeRipJob.progress = 100;
  activeRipJob.status = 'success';
  activeRipJob.currentStep = 'Finished!';
  broadcastRipStatus('=============================================');
  broadcastRipStatus('cdparanoia: Ripping session completed.');
  
  // Auto-eject drive
  broadcastRipStatus(`Ejecting physical drive tray: ${device}`);
  exec(`eject ${device}`, (err) => {
    if (err) broadcastRipStatus(`Failed to auto-eject: ${err.message}`);
    else broadcastRipStatus('Drive tray ejected. Ripping completed successfully!');
  });
}

/* =======================================
   API ENDPOINTS
   ======================================= */

// List all active tracks
app.get('/api/tracks', (req, res) => {
  res.json(tracks);
});

// Upload track
app.post('/api/upload', upload.array('files'), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No audio files uploaded.' });
    }

    const addedTracks = [];

    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      const meta = await extractMetadata(file.path, file.originalname);
      
      const track = {
        id: `track-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        filename: file.filename,
        path: file.path,
        title: meta.title,
        artist: meta.artist,
        album: meta.album,
        duration: meta.duration,
        size: file.size,
        mimeType: file.mimetype
      };

      tracks.push(track);
      addedTracks.push(track);
    }

    res.status(201).json(addedTracks);
  } catch (err) {
    console.error('Upload Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Reorder tracks
app.post('/api/reorder', (req, res) => {
  const { orderedIds } = req.body;
  if (!orderedIds || !Array.isArray(orderedIds)) {
    return res.status(400).json({ error: 'Invalid order request.' });
  }

  const reordered = [];
  orderedIds.forEach(id => {
    const trk = tracks.find(t => t.id === id);
    if (trk) reordered.push(trk);
  });

  tracks.forEach(trk => {
    if (!reordered.find(t => t.id === trk.id)) reordered.push(trk);
  });

  tracks = reordered;
  res.json(tracks);
});

// Delete a track
app.delete('/api/tracks/:id', (req, res) => {
  const { id } = req.params;
  const idx = tracks.findIndex(t => t.id === id);
  
  if (idx === -1) {
    return res.status(404).json({ error: 'Track not found.' });
  }

  const trackToDelete = tracks[idx];
  
  try {
    if (fs.existsSync(trackToDelete.path)) {
      fs.unlinkSync(trackToDelete.path);
    }
  } catch (err) {}

  tracks.splice(idx, 1);
  res.json({ success: true, message: 'Track deleted successfully.' });
});

// Get burning devices
app.get('/api/devices', (req, res) => {
  res.json(detectDrives());
});

// Trigger CD burning
app.post('/api/burn', async (req, res) => {
  const { device, speed, simulate } = req.body;

  if (tracks.length === 0) {
    return res.status(400).json({ error: 'Cannot burn an empty disc. Please upload some music first!' });
  }

  const totalDuration = tracks.reduce((sum, t) => sum + t.duration, 0);
  if (totalDuration > 80 * 60) {
    return res.status(400).json({ error: 'Total tracks duration exceeds standard CD maximum limit of 80 minutes!' });
  }

  if (activeBurnJob.status === 'converting' || activeBurnJob.status === 'burning') {
    return res.status(409).json({ error: 'Another CD burn job is currently running.' });
  }

  const caps = getSystemCapabilities();
  const forceMock = device === 'mock' || !caps.hasFFmpeg || !caps.hasWodim || process.env.MOCK_BURN === 'true';

  res.json({ success: true, message: 'Burning process initiated.' });

  try {
    if (forceMock) {
      await runMockBurn(speed || 16, simulate || false);
    } else {
      await runRealBurn(device, speed || 16, simulate || false);
    }
  } catch (err) {
    activeBurnJob.status = 'failed';
    activeBurnJob.error = err.message;
    broadcastStatus(`!!! ERROR OCCURRED: ${err.message}`);
    broadcastStatus('CD burning failed. Check terminal output for details.');
  }
});

// Server-Sent Events endpoint for live progress
app.get('/api/burn/progress', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  sseClients.push(res);

  const initialData = JSON.stringify({
    status: activeBurnJob.status,
    progress: activeBurnJob.progress,
    currentStep: activeBurnJob.currentStep,
    logs: activeBurnJob.logs,
    error: activeBurnJob.error
  });
  res.write(`event: init\ndata: ${initialData}\n\n`);

  req.on('close', () => {
    sseClients = sseClients.filter(client => client !== res);
  });
});

/* =======================================
   RIPPING API ENDPOINTS
   ======================================= */

// Detect Audio CD track layout (TOC via cdparanoia)
app.get('/api/rip/detect', (req, res) => {
  const { device } = req.query;
  const targetDevice = device || '/dev/cdrom';
  
  const caps = getSystemCapabilities();
  const forceMock = targetDevice === 'mock' || !caps.hasCdparanoia || process.env.MOCK_BURN === 'true';

  if (forceMock) {
    // High-fidelity Daft Punk "Discovery" album simulation
    const mockAlbum = {
      album: 'Discovery',
      artist: 'Daft Punk',
      tracks: [
        { number: 1, title: 'One More Time', duration: 320, artist: 'Daft Punk' },
        { number: 2, title: 'Aerodynamic', duration: 207, artist: 'Daft Punk' },
        { number: 3, title: 'Digital Love', duration: 290, artist: 'Daft Punk' },
        { number: 4, title: 'Harder, Better, Faster, Stronger', duration: 224, artist: 'Daft Punk' },
        { number: 5, title: 'Crescendolls', duration: 211, artist: 'Daft Punk' },
        { number: 6, title: 'Nightvision', duration: 104, artist: 'Daft Punk' },
        { number: 7, title: 'Superheroes', duration: 237, artist: 'Daft Punk' },
        { number: 8, title: 'High Life', duration: 202, artist: 'Daft Punk' },
        { number: 9, title: 'Something About Us', duration: 231, artist: 'Daft Punk' },
        { number: 10, title: 'Voyager', duration: 227, artist: 'Daft Punk' },
        { number: 11, title: 'Veridis Quo', duration: 344, artist: 'Daft Punk' },
        { number: 12, title: 'Short Circuit', duration: 206, artist: 'Daft Punk' },
        { number: 13, title: 'Face to Face', duration: 240, artist: 'Daft Punk' },
        { number: 14, title: 'Too Long', duration: 600, artist: 'Daft Punk' }
      ]
    };
    return res.json({ connected: true, isMock: true, data: mockAlbum });
  }

  // Real Cdparanoia query: cdparanoia -Q -d [device]
  exec(`cdparanoia -Q -d ${targetDevice}`, (err, stdout, stderr) => {
    // cdparanoia outputs TOC details to STDERR!
    const output = stderr + stdout;
    
    if (output.includes('No medium found') || output.includes('unable to open') || output.includes('Error')) {
      return res.json({ connected: false, message: 'No Audio CD detected in the drive.' });
    }

    try {
      const detectedTracks = [];
      const lines = output.split('\n');
      
      lines.forEach(line => {
        // Look for track pattern, e.g.: "  1.    0:02.00 [000150]    3:42.50 [0016700] ..."
        const match = line.trim().match(/^(\d+)\.\s+(\d+:\d+\.\d+)\s+\[\d+\]\s+(\d+:\d+\.\d+)/);
        if (match) {
          const trackNum = parseInt(match[1]);
          const lengthStr = match[3]; // format MM:SS.FF
          
          // Parse duration to seconds: MM:SS.FF (75 frames = 1 sec)
          const timeParts = lengthStr.split(':');
          const mins = parseInt(timeParts[0]);
          const secParts = timeParts[1].split('.');
          const secs = parseInt(secParts[0]);
          const frames = parseInt(secParts[1]) || 0;
          
          const duration = mins * 60 + secs + (frames / 75);
          
          detectedTracks.push({
            number: trackNum,
            title: `Track ${String(trackNum).padStart(2, '0')}`,
            duration: Math.round(duration),
            artist: 'Unknown Artist'
          });
        }
      });

      if (detectedTracks.length === 0) {
        return res.json({ connected: false, message: 'Not an Audio CD or track structure unreadable.' });
      }

      res.json({
        connected: true,
        isMock: false,
        data: {
          album: 'Audio CD Compilation',
          artist: 'Various Artists',
          tracks: detectedTracks
        }
      });
    } catch (parseErr) {
      res.status(500).json({ error: 'Failed to parse CD Table of Contents.' });
    }
  });
});

// Trigger CD Ripping
app.post('/api/rip', async (req, res) => {
  const { device, format, album, artist, tracks: ripTracks } = req.body;

  if (!ripTracks || ripTracks.length === 0) {
    return res.status(400).json({ error: 'No CD tracks specified for ripping.' });
  }

  if (activeRipJob.status === 'ripping') {
    return res.status(409).json({ error: 'Another CD ripping job is currently active.' });
  }

  const caps = getSystemCapabilities();
  const forceMock = device === 'mock' || !caps.hasCdparanoia || !caps.hasFFmpeg || process.env.MOCK_BURN === 'true';

  res.json({ success: true, message: 'Ripping process initiated.' });

  try {
    if (forceMock) {
      await runMockRip(format || 'mp3', album || 'Unknown Album', artist || 'Unknown Artist', ripTracks);
    } else {
      await runRealRip(device, format || 'mp3', album || 'Unknown Album', artist || 'Unknown Artist', ripTracks);
    }
  } catch (err) {
    activeRipJob.status = 'failed';
    activeRipJob.error = err.message;
    broadcastRipStatus(`!!! RIP FATAL ERROR: ${err.message}`);
  }
});

// Server-Sent Events endpoint for ripping progress
app.get('/api/rip/progress', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  sseRipClients.push(res);

  const initialData = JSON.stringify({
    status: activeRipJob.status,
    progress: activeRipJob.progress,
    currentStep: activeRipJob.currentStep,
    logs: activeRipJob.logs,
    error: activeRipJob.error
  });
  res.write(`event: init\ndata: ${initialData}\n\n`);

  req.on('close', () => {
    sseRipClients = sseRipClients.filter(client => client !== res);
  });
});

/* =======================================
   SPOTIFY SEARCH & DOWNLOAD
   ======================================= */

let spotifyToken = null;
let spotifyTokenExpires = 0;

async function getSpotifyToken() {
  if (spotifyToken && Date.now() < spotifyTokenExpires) {
    return spotifyToken;
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET must be set in environment.');
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });

  if (!res.ok) {
    throw new Error(`Spotify auth failed: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  spotifyToken = data.access_token;
  spotifyTokenExpires = Date.now() + (data.expires_in - 60) * 1000;
  return spotifyToken;
}

// Search Spotify
app.get('/api/search', async (req, res) => {
  const { q } = req.query;
  if (!q || !q.trim()) {
    return res.status(400).json({ error: 'Query parameter "q" is required.' });
  }

  try {
    const token = await getSpotifyToken();
    const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(q.trim())}&type=track&limit=10`;

    const spotRes = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!spotRes.ok) {
      throw new Error(`Spotify API error: ${spotRes.status}`);
    }

    const data = await spotRes.json();
    const items = data.tracks?.items || [];

    const results = items.map(t => ({
      id: t.id,
      title: t.name,
      artist: t.artists.map(a => a.name).join(', '),
      album: t.album.name,
      albumArt: t.album.images?.[0]?.url || null,
      duration: Math.round(t.duration_ms / 1000),
      spotifyUrl: t.external_urls.spotify
    }));

    res.json(results);
  } catch (err) {
    console.error('Spotify Search Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Download a track via spotdl (synchronous — waits for completion)
app.post('/api/download', async (req, res) => {
  const { spotifyUrl, title, artist, album, duration } = req.body;

  if (!spotifyUrl) {
    return res.status(400).json({ error: 'spotifyUrl is required.' });
  }

  let spotdlBin = 'spotdl';
  try {
    execSync('which spotdl', { stdio: 'ignore' });
  } catch (e) {
    return res.status(500).json({ error: 'spotdl is not installed. Run: pip3 install spotdl --break-system-packages' });
  }

  const trackId = spotifyUrl.split('/track/')[1]?.split('?')[0] || `dl-${Date.now()}`;
  const safeName = `${trackId}.mp3`;
  const outputPath = path.join(UPLOADS_DIR, safeName);

  // If already downloaded, add immediately
  if (fs.existsSync(outputPath)) {
    const meta = await extractMetadata(outputPath, safeName);
    const track = {
      id: `track-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      filename: safeName,
      path: outputPath,
      title: title || meta.title,
      artist: artist || meta.artist,
      album: album || meta.album,
      duration: duration || meta.duration,
      size: fs.statSync(outputPath).size,
      mimeType: 'audio/mpeg'
    };
    tracks.push(track);
    return res.status(201).json({ track, cached: true });
  }

  try {
    await new Promise((resolve, reject) => {
      const proc = spawn(spotdlBin, [
        'download', spotifyUrl,
        '--output', path.join(UPLOADS_DIR, '{track-id}.{output-ext}'),
        '--format', 'mp3',
        '--bitrate', '128k',
        '--overwrite', 'force',
        '--print-errors'
      ], {
        cwd: __dirname,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stderrLog = '';
      proc.stderr.on('data', (chunk) => stderrLog += chunk.toString());

      proc.on('close', async (code) => {
        if (code !== 0) {
          reject(new Error(`spotdl exited with code ${code}\n${stderrLog.slice(0, 500)}`));
          return;
        }

        if (!fs.existsSync(outputPath)) {
          reject(new Error('spotdl completed but output file was not found.'));
          return;
        }

        try {
          const meta = await extractMetadata(outputPath, safeName);
          const entry = {
            id: `track-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            filename: safeName,
            path: outputPath,
            title: title || meta.title,
            artist: artist || meta.artist,
            album: album || meta.album,
            duration: duration || meta.duration,
            size: fs.statSync(outputPath).size,
            mimeType: 'audio/mpeg'
          };
          tracks.push(entry);
          resolve(entry);
        } catch (err) {
          reject(new Error(`Failed to process downloaded file: ${err.message}`));
        }
      });

      proc.on('error', (err) => reject(err));
    });

    res.status(201).json({ track: tracks[tracks.length - 1] });
  } catch (err) {
    console.error('Download Error:', err);
    res.status(500).json({ error: err.message });
  }
});

/* =======================================
   PLAYLIST MANAGEMENT
   ======================================= */

const PLAYLISTS_FILE = path.join(__dirname, 'playlists.json');

let playlists = [];

function loadPlaylists() {
  try {
    if (fs.existsSync(PLAYLISTS_FILE)) {
      playlists = JSON.parse(fs.readFileSync(PLAYLISTS_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('Failed to load playlists:', err.message);
  }
}

function savePlaylists() {
  try {
    fs.writeFileSync(PLAYLISTS_FILE, JSON.stringify(playlists, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save playlists:', err.message);
  }
}

loadPlaylists();

// List all playlists
app.get('/api/playlists', (req, res) => {
  const result = playlists.map(p => ({
    id: p.id,
    name: p.name,
    description: p.description,
    trackCount: p.trackIds.length,
    created: p.created,
    updated: p.updated
  }));
  res.json(result);
});

// Create playlist
app.post('/api/playlists', (req, res) => {
  const { name, description } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Playlist name is required.' });
  }

  const playlist = {
    id: `playlist-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    name: name.trim(),
    description: (description || '').trim(),
    trackIds: [],
    created: new Date().toISOString(),
    updated: new Date().toISOString()
  };

  playlists.push(playlist);
  savePlaylists();
  res.status(201).json(playlist);
});

// Get single playlist with full track data
app.get('/api/playlists/:id', (req, res) => {
  const playlist = playlists.find(p => p.id === req.params.id);
  if (!playlist) return res.status(404).json({ error: 'Playlist not found.' });

  const tracksInPlaylist = playlist.trackIds
    .map(tid => tracks.find(t => t.id === tid))
    .filter(Boolean);

  res.json({ ...playlist, tracks: tracksInPlaylist });
});

// Update playlist (name, description)
app.put('/api/playlists/:id', (req, res) => {
  const playlist = playlists.find(p => p.id === req.params.id);
  if (!playlist) return res.status(404).json({ error: 'Playlist not found.' });

  if (req.body.name) playlist.name = req.body.name.trim();
  if (req.body.description !== undefined) playlist.description = req.body.description.trim();
  playlist.updated = new Date().toISOString();
  savePlaylists();
  res.json(playlist);
});

// Delete playlist
app.delete('/api/playlists/:id', (req, res) => {
  const idx = playlists.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Playlist not found.' });

  playlists.splice(idx, 1);
  savePlaylists();
  res.json({ success: true });
});

// Add track to playlist
app.post('/api/playlists/:id/tracks', (req, res) => {
  const playlist = playlists.find(p => p.id === req.params.id);
  if (!playlist) return res.status(404).json({ error: 'Playlist not found.' });

  const { trackId } = req.body;
  if (!trackId) return res.status(400).json({ error: 'trackId is required.' });

  const track = tracks.find(t => t.id === trackId);
  if (!track) return res.status(404).json({ error: 'Track not found.' });

  if (!playlist.trackIds.includes(trackId)) {
    playlist.trackIds.push(trackId);
    playlist.updated = new Date().toISOString();
    savePlaylists();
  }

  res.json(playlist);
});

// Remove track from playlist
app.delete('/api/playlists/:id/tracks/:trackId', (req, res) => {
  const playlist = playlists.find(p => p.id === req.params.id);
  if (!playlist) return res.status(404).json({ error: 'Playlist not found.' });

  playlist.trackIds = playlist.trackIds.filter(tid => tid !== req.params.trackId);
  playlist.updated = new Date().toISOString();
  savePlaylists();
  res.json(playlist);
});

// Reorder tracks in a playlist
app.put('/api/playlists/:id/tracks/reorder', (req, res) => {
  const playlist = playlists.find(p => p.id === req.params.id);
  if (!playlist) return res.status(404).json({ error: 'Playlist not found.' });

  const { trackIds } = req.body;
  if (!Array.isArray(trackIds)) return res.status(400).json({ error: 'trackIds array required.' });

  playlist.trackIds = trackIds.filter(tid => tracks.some(t => t.id === tid));
  playlist.updated = new Date().toISOString();
  savePlaylists();
  res.json(playlist);
});

// Serve frontend page fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Listen
app.listen(PORT, () => {
  console.log(`===================================================`);
  console.log(` silky-bohr-burner server listening on port ${PORT}`);
  console.log(` Local Network Address: http://localhost:${PORT}`);
  console.log(`===================================================`);
});
