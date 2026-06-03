// Core State
let localTracks = [];
let draggingRowIndex = null;
let eventSource = null;

// Ripping State
let detectedCD = null;
let isScanningCD = false;
let isRippingCD = false;
let ripEventSource = null;
let cdPollInterval = null;

// DOM Elements - Mastering & Burning
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const uploadProgressBar = document.getElementById('upload-progress-bar');
const uploadProgressFill = uploadProgressBar.querySelector('.upload-progress-fill');
const uploadProgressText = uploadProgressBar.querySelector('.upload-progress-text');

const tracksTbody = document.getElementById('tracks-tbody');
const trackCountBadge = document.getElementById('track-count');
const clearAllBtn = document.getElementById('clear-all-btn');

const capacityFill = document.getElementById('capacity-fill');
const capacityTime = document.getElementById('capacity-time');
const capacityPercentage = document.getElementById('capacity-percentage');

const driveSelect = document.getElementById('drive-select');
const speedSelect = document.getElementById('speed-select');
const simulateCheckbox = document.getElementById('simulate-checkbox');
const burnBtn = document.getElementById('burn-btn');

const progressDialog = document.getElementById('progress-dialog');
const dialogTitle = document.getElementById('dialog-title');
const dialogBadge = document.getElementById('dialog-badge');
const vinylDisc = document.getElementById('vinyl-disc');
const turntableArm = document.querySelector('.turntable-arm');
const currentStepLabel = document.getElementById('current-step-label');
const overallPercentageLabel = document.getElementById('overall-percentage-label');
const dialogProgressFill = document.getElementById('dialog-progress-fill');
const consoleLog = document.getElementById('console-log');
const closeDialogBtn = document.getElementById('close-dialog-btn');

// DOM Elements - Spotify Search
const searchInput = document.getElementById('search-input');
const searchBtn = document.getElementById('search-btn');
const searchResults = document.getElementById('search-results');
const searchError = document.getElementById('search-error');
const searchSpinner = document.getElementById('search-spinner');
let isDownloading = false;

// DOM Elements - Navigation & Archiving
const tabMaster = document.getElementById('tab-master');
const tabRip = document.getElementById('tab-rip');
const masterView = document.getElementById('master-view');
const ripView = document.getElementById('rip-view');

const refreshCDBtn = document.getElementById('refresh-cd-btn');
const ripAlbumInput = document.getElementById('rip-album-input');
const ripArtistInput = document.getElementById('rip-artist-input');
const ripTracksTbody = document.getElementById('rip-tracks-tbody');

const laserLensCD = document.getElementById('laser-lens-cd');
const ripDriveTitle = document.getElementById('rip-drive-title');
const ripDriveSubtitle = document.getElementById('rip-drive-subtitle');

const ripDriveSelect = document.getElementById('rip-drive-select');
const ripFormatSelect = document.getElementById('rip-format-select');
const ripBtn = document.getElementById('rip-btn');

const ripProgressDialog = document.getElementById('rip-progress-dialog');
const closeRipDialogBtn = document.getElementById('close-rip-dialog-btn');

// Playlist State
let playlists = [];
let selectedPlaylistId = null;
// DOM Elements - Playlists
const tabPlaylists = document.getElementById('tab-playlists');
const playlistsView = document.getElementById('playlists-view');
const playlistList = document.getElementById('playlist-list');
const newPlaylistBtn = document.getElementById('new-playlist-btn');
const playlistDetail = document.getElementById('playlist-detail');
const playlistDetailTitle = document.getElementById('playlist-detail-title');
const playlistDetailName = document.getElementById('playlist-detail-name');
const playlistTracksTbody = document.getElementById('playlist-tracks-tbody');
const deletePlaylistBtn = document.getElementById('delete-playlist-btn');

// DOM Elements - New Playlist Modal
const newPlaylistDialog = document.getElementById('new-playlist-dialog');
const newPlaylistNameInput = document.getElementById('new-playlist-name-input');
const newPlaylistSubmit = document.getElementById('new-playlist-submit');
const newPlaylistCancel = document.getElementById('new-playlist-cancel');
const newPlaylistClose = document.getElementById('new-playlist-close');
let pendingPlaylistTrackId = null;

/* ==========================================================================
   Initialisation
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
  fetchTracks();
  fetchDevices();
  setupDragAndDropUpload();
  setupTableSorting();
  setupScrollAffordances();
  setupTabControls();
  setupCDDetection();
  setupPlaylistTab();
  setupPlaylistDropdowns();
  loadPlaylists();

  // Clear all button action
  clearAllBtn.addEventListener('click', clearAllTracks);

  // Burn button action
  burnBtn.addEventListener('click', startBurnProcess);

  // Close dialog action
  closeDialogBtn.addEventListener('click', () => {
    progressDialog.close();
    // Reset SSE and dialog elements
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  });

  // Rip button action
  ripBtn.addEventListener('click', startCDRipProcess);

  // Close rip dialog action
  closeRipDialogBtn.addEventListener('click', () => {
    ripProgressDialog.close();
    if (ripEventSource) {
      ripEventSource.close();
      ripEventSource = null;
    }
  });

  // Refresh CD button action
  refreshCDBtn.addEventListener('click', () => {
    scanInsertedCD(true);
  });

  // Spotify search
  searchBtn.addEventListener('click', performSearch);
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') performSearch();
  });
});

/* ==========================================================================
   SPA Tab Routing
   ========================================================================== */
function setupTabControls() {
  tabMaster.addEventListener('click', () => {
    tabMaster.classList.add('active');
    tabRip.classList.remove('active');
    masterView.classList.add('active');
    ripView.classList.remove('active');
    stopCDPolling();
  });

  tabRip.addEventListener('click', () => {
    tabRip.classList.add('active');
    tabMaster.classList.remove('active');
    tabPlaylists.classList.remove('active');
    ripView.classList.add('active');
    masterView.classList.remove('active');
    playlistsView.classList.remove('active');
    startCDPolling();
    stopPlaylistPolling();
  });

  tabPlaylists.addEventListener('click', () => {
    tabPlaylists.classList.add('active');
    tabMaster.classList.remove('active');
    tabRip.classList.remove('active');
    playlistsView.classList.add('active');
    masterView.classList.remove('active');
    ripView.classList.remove('active');
    stopCDPolling();
    loadPlaylists();
  });
}

/* ==========================================================================
   API Helpers
   ========================================================================== */

// Fetch tracks list from server
async function fetchTracks() {
  try {
    const res = await fetch('/api/tracks');
    if (!res.ok) throw new Error('Failed to load playlist queue.');
    localTracks = await res.json();
    renderTracksTable();
  } catch (err) {
    console.error('Error fetching tracks:', err);
    showStatusText('Error connecting to server', false);
  }
}

// Fetch CD burners and readers list from server
async function fetchDevices() {
  try {
    const res = await fetch('/api/devices');
    if (!res.ok) throw new Error('Failed to query burners.');
    const devices = await res.json();
    
    driveSelect.innerHTML = '';
    ripDriveSelect.innerHTML = '';
    
    if (devices.length === 0) {
      const opt = document.createElement('option');
      opt.value = 'mock';
      opt.textContent = 'Mock Burner (Dev Simulator Only)';
      driveSelect.appendChild(opt);

      const ripOpt = document.createElement('option');
      ripOpt.value = 'mock';
      ripOpt.textContent = 'Mock Reader (Dev Simulator Only)';
      ripDriveSelect.appendChild(ripOpt);
    } else {
      devices.forEach(dev => {
        // Burner select
        const opt = document.createElement('option');
        opt.value = dev.device;
        opt.textContent = dev.name;
        driveSelect.appendChild(opt);

        // Reader select (format as Reader)
        const ripOpt = document.createElement('option');
        ripOpt.value = dev.device;
        ripOpt.textContent = dev.name.replace('Burner', 'Reader').replace('Writer', 'Reader');
        ripDriveSelect.appendChild(ripOpt);
      });
    }
  } catch (err) {
    console.error('Error fetching drives:', err);
    // Safe default option fallback
    driveSelect.innerHTML = '<option value="mock">Mock Burner (Dev Simulator Only)</option>';
    ripDriveSelect.innerHTML = '<option value="mock">Mock Reader (Dev Simulator Only)</option>';
  }
}

/* ==========================================================================
   Drag & Drop Audio Uploads
   ========================================================================== */
function setupDragAndDropUpload() {
  // Click dropzone to trigger input
  dropZone.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      uploadFiles(fileInput.files);
    }
  });

  // Drag over states
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      uploadFiles(e.dataTransfer.files);
    }
  });
}

// Perform uploads with standard progress math (using classic XHR)
function uploadFiles(fileList) {
  const formData = new FormData();
  let validFilesCount = 0;

  for (let i = 0; i < fileList.length; i++) {
    const file = fileList[i];
    // Simple verification
    if (file.type.startsWith('audio/') || /\.(mp3|wav|flac|m4a|ogg|aac|wma|aiff)$/i.test(file.name)) {
      formData.append('files', file);
      validFilesCount++;
    }
  }

  if (validFilesCount === 0) {
    alert('Please upload audio formats only! (MP3, WAV, FLAC, M4A, etc.)');
    return;
  }

  // Display upload progress loader bar
  uploadProgressBar.classList.remove('hidden');
  uploadProgressFill.style.width = '0%';
  uploadProgressText.textContent = `Uploading 0%...`;

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/upload', true);

  // Track upload percentage
  xhr.upload.addEventListener('progress', (e) => {
    if (e.lengthComputable) {
      const percentage = Math.round((e.loaded / e.total) * 100);
      uploadProgressFill.style.width = `${percentage}%`;
      uploadProgressText.textContent = `Uploading ${percentage}%...`;
    }
  });

  xhr.onload = () => {
    uploadProgressBar.classList.add('hidden');
    fileInput.value = ''; // Reset file input
    
    if (xhr.status === 201) {
      fetchTracks();
    } else {
      let errMsg = 'Failed to upload files.';
      try {
        const errObj = JSON.parse(xhr.responseText);
        errMsg = errObj.error || errMsg;
      } catch (e) {}
      alert(`Upload Error: ${errMsg}`);
    }
  };

  xhr.onerror = () => {
    uploadProgressBar.classList.add('hidden');
    alert('Network error during upload transaction.');
  };

  xhr.send(formData);
}

// Clear all tracks helper
async function clearAllTracks() {
  if (!confirm('Are you sure you want to clear the entire tracks queue? This will delete uploaded files from the server.')) {
    return;
  }

  try {
    // Delete each track sequentially
    for (const track of localTracks) {
      await fetch(`/api/tracks/${track.id}`, { method: 'DELETE' });
    }
    fetchTracks();
  } catch (err) {
    console.error('Failed to clear tracks:', err);
    alert('Error cleaning tracks from server.');
  }
}

// Delete single track
async function deleteTrack(trackId) {
  try {
    const res = await fetch(`/api/tracks/${trackId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Delete call failed.');
    fetchTracks();
  } catch (err) {
    console.error('Failed to delete track:', err);
    alert('Failed to delete track file.');
  }
}

/* ==========================================================================
   Table Row Sorting (Reordering) Logic
   ========================================================================== */
function setupTableSorting() {
  tracksTbody.addEventListener('dragstart', (e) => {
    const tr = e.target.closest('tr');
    if (!tr || tr.classList.contains('empty-state')) return;
    
    draggingRowIndex = tr.dataset.index;
    tr.classList.add('dragging');
  });

  tracksTbody.addEventListener('dragover', (e) => {
    e.preventDefault();
    const tr = e.target.closest('tr');
    if (!tr || tr.classList.contains('empty-state') || tr.classList.contains('dragging')) return;
    
    // Add visual line indicator on drag-over target
    tr.classList.add('drag-over');
  });

  tracksTbody.addEventListener('dragleave', (e) => {
    const tr = e.target.closest('tr');
    if (tr) {
      tr.classList.remove('drag-over');
    }
  });

  tracksTbody.addEventListener('dragend', (e) => {
    const tr = e.target.closest('tr');
    if (tr) tr.classList.remove('dragging');
    
    const rows = tracksTbody.querySelectorAll('tr');
    rows.forEach(r => r.classList.remove('drag-over'));
  });

  tracksTbody.addEventListener('drop', async (e) => {
    e.preventDefault();
    const tr = e.target.closest('tr');
    if (!tr || tr.classList.contains('empty-state') || tr.classList.contains('dragging')) return;
    
    tr.classList.remove('drag-over');
    
    const dragIdx = parseInt(draggingRowIndex);
    const dropIdx = parseInt(tr.dataset.index);

    if (isNaN(dragIdx) || isNaN(dropIdx) || dragIdx === dropIdx) return;

    // Shift item inside the local tracks array
    const targetItem = localTracks[dragIdx];
    localTracks.splice(dragIdx, 1); // remove
    localTracks.splice(dropIdx, 0, targetItem); // insert

    // Push new ordering order to server API
    try {
      const orderedIds = localTracks.map(t => t.id);
      const res = await fetch('/api/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedIds })
      });
      if (!res.ok) throw new Error('Order re-allocation rejected.');
      
      // Update local state and render again
      localTracks = await res.json();
      renderTracksTable();
    } catch (err) {
      console.error('Failed to save track order:', err);
      fetchTracks(); // Reset from server
    }
  });
}

/* ==========================================================================
   UI Render & State Calculations
   ========================================================================== */
function renderTracksTable() {
  tracksTbody.innerHTML = '';

  // Update track count badge
  trackCountBadge.textContent = `${localTracks.length} Track${localTracks.length === 1 ? '' : 's'}`;
  
  if (localTracks.length === 0) {
    clearAllBtn.classList.add('hidden');
    
    const tr = document.createElement('tr');
    tr.className = 'empty-state';
    tr.innerHTML = `
      <td colspan="7">
        <div class="empty-state-content">
          <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          <p>No tracks added yet. Upload files above or rip an Audio CD to build your custom album.</p>
        </div>
      </td>
    `;
    tracksTbody.appendChild(tr);
    calculateCapacity(0);
    return;
  }

  clearAllBtn.classList.remove('hidden');

  let cumulativeDuration = 0;

  localTracks.forEach((track, index) => {
    cumulativeDuration += track.duration;
    const tr = document.createElement('tr');
    tr.draggable = true;
    tr.dataset.index = index;
    tr.dataset.id = track.id;

    // Formatting durations and sizes
    const durationStr = formatTime(track.duration);
    const sizeStr = formatBytes(track.size);
    const orderStr = String(index + 1).padStart(2, '0');

    tr.innerHTML = `
      <td>
        <div class="track-number-col">
          <span class="drag-handle">⠿</span>
          <span>${orderStr}</span>
        </div>
      </td>
      <td class="track-title-cell">${escapeHTML(track.title)}</td>
      <td class="track-artist-cell">${escapeHTML(track.artist)}</td>
      <td class="track-album-cell">${escapeHTML(track.album)}</td>
      <td class="track-duration-cell text-right">${durationStr}</td>
      <td class="track-size-cell text-right">${sizeStr}</td>
      <td class="text-center">
        <div class="track-actions">
          <div class="playlist-dropdown" data-track-id="${track.id}">
            <button class="playlist-dropdown-toggle" title="Add to playlist">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
            <div class="playlist-dropdown-menu hidden"></div>
          </div>
          <button class="delete-btn" title="Delete Track" onclick="deleteTrack('${track.id}')">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <line x1="10" y1="11" x2="10" y2="17" />
              <line x1="14" y1="11" x2="14" y2="17" />
            </svg>
          </button>
        </div>
      </td>
    `;

    tracksTbody.appendChild(tr);
  });

  calculateCapacity(cumulativeDuration);
}

// Perform Disc Limit math
function calculateCapacity(totalSeconds) {
  const cdLimitSeconds = 80 * 60; // 80 minutes
  const percent = Math.min((totalSeconds / cdLimitSeconds) * 100, 100);

  // CSS fill styling
  capacityFill.style.width = `${percent}%`;
  capacityTime.textContent = `${formatTime(totalSeconds)} / 80:00`;
  capacityPercentage.textContent = `${percent.toFixed(1)}% Used`;

  // Capacity threshold warnings
  if (totalSeconds > cdLimitSeconds) {
    capacityFill.classList.add('overlimit');
    burnBtn.disabled = true;
    burnBtn.setAttribute('title', 'Disc limit exceeded! Tracks duration must be under 80 minutes to burn.');
    showStatusText('CD Capacity Exceeded', false);
  } else {
    capacityFill.classList.remove('overlimit');
    
    if (totalSeconds > 0) {
      burnBtn.disabled = false;
      burnBtn.removeAttribute('title');
      showStatusText('Server Connected', true);
    } else {
      burnBtn.disabled = true;
      burnBtn.setAttribute('title', 'Please upload or rip some tracks first!');
    }
  }
}

/* ==========================================================================
   CD Burning Event Pipeline (SSE)
   ========================================================================== */
async function startBurnProcess() {
  const device = driveSelect.value;
  const speed = parseInt(speedSelect.value);
  const simulate = simulateCheckbox.checked;

  if (localTracks.length === 0) return;

  try {
    const res = await fetch('/api/burn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device, speed, simulate })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to initiate burning.');
    }

    // Burn launched successfully, open UI status Dialog modal
    openProgressModal(speed, simulate);
  } catch (err) {
    console.error('Burn Launch Error:', err);
    alert(`Error: ${err.message}`);
  }
}

function openProgressModal(speed, isSimulated) {
  // Clear logs and prepare Dialog elements
  consoleLog.textContent = 'Opening secure system bridge pipeline...\n';
  currentStepLabel.textContent = 'Connecting to server engine...';
  overallPercentageLabel.textContent = '0%';
  dialogProgressFill.style.width = '0%';
  
  dialogTitle.textContent = isSimulated ? 'Simulating Optical CD Burn' : 'Mastering Audio CD Burn';
  dialogBadge.textContent = 'Active';
  dialogBadge.className = 'badge badge-active';
  
  closeDialogBtn.classList.add('hidden');

  // Trigger deck graphics transition
  vinylDisc.className = 'vinyl-disc spin-slow'; // Start slow conversion spinner
  turntableArm.style.transform = 'rotate(32deg)'; // Arm drops on CD

  // Display dialog modal
  progressDialog.showModal();

  // Create EventSource SSE Stream listener
  if (eventSource) eventSource.close();
  
  eventSource = new EventSource('/api/burn/progress');

  // Load history list on startup
  eventSource.addEventListener('init', (e) => {
    try {
      const state = JSON.parse(e.data);
      if (state.logs && state.logs.length > 0) {
        consoleLog.textContent = state.logs.join('\n') + '\n';
        scrollConsoleToBottom();
      }
      updateUIStatus(state, speed);
    } catch (err) {
      console.error(err);
    }
  });

  // Track progress stream lines
  eventSource.addEventListener('progress', (e) => {
    try {
      const state = JSON.parse(e.data);
      if (state.logLine) {
        consoleLog.textContent += state.logLine + '\n';
        scrollConsoleToBottom();
      }
      updateUIStatus(state, speed);
    } catch (err) {
      console.error(err);
    }
  });

  eventSource.onerror = (err) => {
    console.error('SSE connection error:', err);
    consoleLog.textContent += '\n[System Error]: SSE bridge lost connection. Re-synchronising...\n';
    scrollConsoleToBottom();
  };
}

// Update modal elements based on current job stage
function updateUIStatus(state, speed) {
  currentStepLabel.textContent = state.currentStep || 'Working...';
  overallPercentageLabel.textContent = `${state.progress}%`;
  dialogProgressFill.style.width = `${state.progress}%`;

  // Dynamically scale CD spinner rotations
  if (state.status === 'converting') {
    vinylDisc.className = 'vinyl-disc spin-slow';
    dialogBadge.textContent = 'Converting';
    dialogBadge.className = 'badge badge-active';
  } else if (state.status === 'burning') {
    vinylDisc.className = 'vinyl-disc spin-fast';
    dialogBadge.textContent = 'Writing CD';
    dialogBadge.className = 'badge badge-active';
    // Update label to show actual selected burning speed
    document.querySelector('.label-speed').textContent = `${speed}x Write`;
  }

  // Handle final completion states
  if (state.status === 'success' || state.status === 'failed') {
    // Lift arm and halt rotations
    vinylDisc.classList.add('paused');
    turntableArm.style.transform = 'rotate(15deg)';

    closeDialogBtn.classList.remove('hidden');

    if (state.status === 'success') {
      dialogBadge.textContent = 'Completed';
      dialogBadge.className = 'badge';
      dialogBadge.style.backgroundColor = 'var(--state-success)';
      dialogBadge.style.color = 'white';
    } else {
      dialogBadge.textContent = 'Failed';
      dialogBadge.className = 'badge';
      dialogBadge.style.backgroundColor = 'var(--state-danger)';
      dialogBadge.style.color = 'white';
      
      currentStepLabel.textContent = 'Burning aborted due to system failures.';
      if (state.error) {
        consoleLog.textContent += `\n[Fatal Error]: ${state.error}\n`;
        scrollConsoleToBottom();
      }
    }

    // Close stream
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  }
}

/* ==========================================================================
   CD Ripping & Archiving Engine
   ========================================================================== */

function setupCDDetection() {
  // Bind drive select change to immediate scan
  ripDriveSelect.addEventListener('change', () => {
    scanInsertedCD();
  });
  
  // Trigger initial scan state on load
  scanInsertedCD();
}

function startCDPolling() {
  if (cdPollInterval) clearInterval(cdPollInterval);
  // Scan immediately
  scanInsertedCD();
  // Poll every 10 seconds to discover newly inserted discs
  cdPollInterval = setInterval(() => {
    const ripActive = ripView.classList.contains('active');
    const ripModalOpen = ripProgressDialog.open;
    if (ripActive && !ripModalOpen && !isRippingCD && !isScanningCD) {
      scanInsertedCD();
    }
  }, 10000);
}

function stopCDPolling() {
  if (cdPollInterval) {
    clearInterval(cdPollInterval);
    cdPollInterval = null;
  }
}

async function scanInsertedCD(isManual = false) {
  if (isScanningCD || isRippingCD) return;
  isScanningCD = true;

  if (isManual) {
    refreshCDBtn.disabled = true;
    refreshCDBtn.innerHTML = `
      <svg class="cd-logo" viewBox="0 0 100 100" width="16" height="16" style="animation: spinSlow 2s linear infinite; margin-right: 4px;">
        <circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" stroke-width="10" />
      </svg>
      Scanning...
    `;
  }

  try {
    const dev = ripDriveSelect.value || 'mock';
    const res = await fetch(`/api/rip/detect?device=${encodeURIComponent(dev)}`);
    if (!res.ok) throw new Error('Failed to query CD reader.');
    
    const result = await res.json();
    
    if (result.connected && result.data) {
      // CD is present!
      detectedCD = result.data;
      
      laserLensCD.classList.remove('paused');
      ripDriveTitle.textContent = detectedCD.album || 'Audio CD Compilation';
      ripDriveSubtitle.textContent = `Loaded & Connected (${detectedCD.tracks.length} Tracks)`;
      
      ripAlbumInput.value = detectedCD.album || '';
      ripArtistInput.value = detectedCD.artist || '';
      ripAlbumInput.removeAttribute('disabled');
      ripArtistInput.removeAttribute('disabled');
      
      renderCDTracksTable();
      ripBtn.disabled = false;
      ripBtn.removeAttribute('title');
    } else {
      // No CD detected
      clearCDState();
    }
  } catch (err) {
    console.error('CD scan error:', err);
    clearCDState();
  } finally {
    isScanningCD = false;
    if (isManual) {
      refreshCDBtn.disabled = false;
      refreshCDBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
        </svg>
        Scan Drive
      `;
    }
  }
}

function clearCDState() {
  detectedCD = null;
  laserLensCD.classList.add('paused');
  ripDriveTitle.textContent = 'No CD Detected';
  ripDriveSubtitle.textContent = 'Insert music disc to start';
  
  ripAlbumInput.value = '';
  ripArtistInput.value = '';
  ripAlbumInput.setAttribute('disabled', 'true');
  ripArtistInput.setAttribute('disabled', 'true');
  
  renderCDTracksTable();
  ripBtn.disabled = true;
  ripBtn.setAttribute('title', 'Please insert a CD and click Scan Drive first!');
}

function renderCDTracksTable() {
  ripTracksTbody.innerHTML = '';
  
  if (!detectedCD || !detectedCD.tracks || detectedCD.tracks.length === 0) {
    ripTracksTbody.innerHTML = `
      <tr class="empty-state">
        <td colspan="4">
          <div class="empty-state-content">
            <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1">
              <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
              <path d="M12 18V6M6 12h12" />
            </svg>
            <p>No audio disc detected. Insert a music CD into the server drive and click "Scan Drive".</p>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  detectedCD.tracks.forEach(track => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="text-center" style="font-family: var(--font-mono); font-weight: bold; color: var(--text-muted); font-size: 0.95rem;">
        ${String(track.number).padStart(2, '0')}
      </td>
      <td>
        <input type="text" 
               class="rip-track-input" 
               data-track-number="${track.number}" 
               value="${escapeHTML(track.title)}"
               placeholder="Enter track title..."
        >
      </td>
      <td class="text-right" style="font-family: var(--font-mono); color: var(--accent-secondary); font-weight: 500; font-size: 0.95rem;">
        ${formatTime(track.duration)}
      </td>
      <td class="text-center">
        <span class="rip-status-badge rip-status-pending" data-track-number="${track.number}">Queued</span>
      </td>
    `;
    ripTracksTbody.appendChild(tr);
  });
}

async function startCDRipProcess() {
  if (!detectedCD || isRippingCD) return;

  const device = ripDriveSelect.value;
  const format = ripFormatSelect.value;
  const album = ripAlbumInput.value.trim() || 'Unknown Album';
  const artist = ripArtistInput.value.trim() || 'Unknown Artist';

  // Retrieve edited track titles from renamer text inputs!
  const trackInputs = document.querySelectorAll('.rip-track-input');
  const tracksPayload = [];
  trackInputs.forEach(input => {
    const num = parseInt(input.dataset.trackNumber);
    const title = input.value.trim() || `Track ${String(num).padStart(2, '0')}`;
    const originalTrack = detectedCD.tracks.find(t => t.number === num);
    tracksPayload.push({
      number: num,
      title: title,
      duration: originalTrack ? originalTrack.duration : 240
    });
  });

  if (tracksPayload.length === 0) {
    alert('No tracks found to rip!');
    return;
  }

  isRippingCD = true;
  ripBtn.disabled = true;
  ripBtn.textContent = 'Initialising Rip...';

  try {
    const res = await fetch('/api/rip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device,
        format,
        album,
        artist,
        tracks: tracksPayload
      })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to start CD ripping.');
    }

    openRipProgressModal(format);
  } catch (err) {
    console.error('CD Rip error:', err);
    alert(`Error: ${err.message}`);
    isRippingCD = false;
    ripBtn.disabled = false;
    ripBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      Extract & Rip Audio CD
    `;
  }
}

function openRipProgressModal(format) {
  const ripConsoleLog = document.getElementById('rip-console-log');
  const ripCurrentStepLabel = document.getElementById('rip-current-step-label');
  const ripOverallPercentageLabel = document.getElementById('rip-overall-percentage-label');
  const ripDialogProgressFill = document.getElementById('rip-dialog-progress-fill');
  const ripDialogTitle = document.getElementById('rip-dialog-title');
  const ripDialogBadge = document.getElementById('rip-dialog-badge');
  const ripVinylDisc = document.getElementById('rip-vinyl-disc');
  const ripTurntableArm = ripProgressDialog.querySelector('.turntable-arm');
  const closeRipDialogBtn = document.getElementById('close-rip-dialog-btn');

  // Reset progress and console content
  ripConsoleLog.textContent = 'Establishing secure pipeline connection to server cdparanoia parser...\n';
  ripCurrentStepLabel.textContent = 'Spawning extraction background threads...';
  ripOverallPercentageLabel.textContent = '0%';
  ripDialogProgressFill.style.width = '0%';
  
  ripDialogTitle.textContent = `Archiving & Ripping Audio CD`;
  ripDialogBadge.textContent = 'Active';
  ripDialogBadge.className = 'badge badge-active';
  ripDialogBadge.style.backgroundColor = '';
  ripDialogBadge.style.color = '';
  
  closeRipDialogBtn.classList.add('hidden');

  // Trigger animations
  ripVinylDisc.className = 'vinyl-disc spin-fast'; 
  ripTurntableArm.style.transform = 'rotate(32deg)'; 

  ripProgressDialog.showModal();

  if (ripEventSource) ripEventSource.close();
  
  ripEventSource = new EventSource('/api/rip/progress');

  ripEventSource.addEventListener('init', (e) => {
    try {
      const state = JSON.parse(e.data);
      if (state.logs && state.logs.length > 0) {
        ripConsoleLog.textContent = state.logs.join('\n') + '\n';
        scrollRipConsoleToBottom();
      }
      updateRipUIStatus(state, format);
    } catch (err) {
      console.error(err);
    }
  });

  ripEventSource.addEventListener('progress', (e) => {
    try {
      const state = JSON.parse(e.data);
      if (state.logLine) {
        ripConsoleLog.textContent += state.logLine + '\n';
        scrollRipConsoleToBottom();
      }
      updateRipUIStatus(state, format);
    } catch (err) {
      console.error(err);
    }
  });

  ripEventSource.onerror = (err) => {
    console.error('SSE Rip Stream connection error:', err);
    ripConsoleLog.textContent += '\n[System Warning]: SSE pipeline dropped. Attempting reconnect...\n';
    scrollRipConsoleToBottom();
  };
}

function updateRipUIStatus(state, format) {
  const ripCurrentStepLabel = document.getElementById('rip-current-step-label');
  const ripOverallPercentageLabel = document.getElementById('rip-overall-percentage-label');
  const ripDialogProgressFill = document.getElementById('rip-dialog-progress-fill');
  const ripDialogBadge = document.getElementById('rip-dialog-badge');
  const ripVinylDisc = document.getElementById('rip-vinyl-disc');
  const ripTurntableArm = ripProgressDialog.querySelector('.turntable-arm');
  const closeRipDialogBtn = document.getElementById('close-rip-dialog-btn');
  const ripConsoleLog = document.getElementById('rip-console-log');

  ripCurrentStepLabel.textContent = state.currentStep || 'Extracting...';
  ripOverallPercentageLabel.textContent = `${state.progress}%`;
  ripDialogProgressFill.style.width = `${state.progress}%`;

  // Parse out track index to update badges in the active ripping tracks grid!
  if (state.currentStep) {
    const match = state.currentStep.match(/(?:Extracting|Encoding) track (\d+)\//i);
    if (match) {
      const currentTrackNum = parseInt(match[1]);
      
      const rows = document.querySelectorAll('#rip-tracks-tbody tr');
      rows.forEach(row => {
        const badge = row.querySelector('.rip-status-badge');
        if (badge) {
          const num = parseInt(badge.dataset.trackNumber);
          if (num < currentTrackNum) {
            badge.textContent = 'Ripped';
            badge.className = 'rip-status-badge rip-status-complete';
          } else if (num === currentTrackNum) {
            badge.textContent = 'Ripping';
            badge.className = 'rip-status-badge rip-status-ripping';
          } else {
            badge.textContent = 'Queued';
            badge.className = 'rip-status-badge rip-status-pending';
          }
        }
      });
    }
  }

  // Final status handlers
  if (state.status === 'success' || state.status === 'failed') {
    ripVinylDisc.classList.add('paused');
    ripTurntableArm.style.transform = 'rotate(15deg)';

    closeRipDialogBtn.classList.remove('hidden');
    isRippingCD = false;
    
    ripBtn.disabled = false;
    ripBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      Extract & Rip Audio CD
    `;

    if (state.status === 'success') {
      ripDialogBadge.textContent = 'Completed';
      ripDialogBadge.className = 'badge';
      ripDialogBadge.style.backgroundColor = 'var(--state-success)';
      ripDialogBadge.style.color = 'white';

      // Update all badges to done
      const badges = document.querySelectorAll('#rip-tracks-tbody .rip-status-badge');
      badges.forEach(b => {
        b.textContent = 'Ripped';
        b.className = 'rip-status-badge rip-status-complete';
      });

      // Synchronise back tracks to Tab 1 Mastering playlist queue
      fetchTracks();
    } else {
      ripDialogBadge.textContent = 'Failed';
      ripDialogBadge.className = 'badge';
      ripDialogBadge.style.backgroundColor = 'var(--state-danger)';
      ripDialogBadge.style.color = 'white';

      ripCurrentStepLabel.textContent = 'Archiving pipeline halted due to sector read errors.';
      if (state.error) {
        ripConsoleLog.textContent += `\n[Fatal CD Extraction Error]: ${state.error}\n`;
        scrollRipConsoleToBottom();
      }
    }

    if (ripEventSource) {
      ripEventSource.close();
      ripEventSource = null;
    }
  }
}

function scrollRipConsoleToBottom() {
  const ripConsoleLog = document.getElementById('rip-console-log');
  if (ripConsoleLog) {
    ripConsoleLog.scrollTop = ripConsoleLog.scrollHeight;
  }
}

/* ==========================================================================
   Playlist Management
   ========================================================================== */

function setupPlaylistTab() {
  newPlaylistBtn.addEventListener('click', () => openNewPlaylistModal(null));
  deletePlaylistBtn.addEventListener('click', deleteSelectedPlaylist);
  playlistDetailName.addEventListener('change', renameSelectedPlaylist);
  document.getElementById('burn-playlist-btn').addEventListener('click', burnSelectedPlaylist);

  // New Playlist modal
  newPlaylistSubmit.addEventListener('click', submitNewPlaylist);
  newPlaylistCancel.addEventListener('click', closeNewPlaylistModal);
  newPlaylistClose.addEventListener('click', closeNewPlaylistModal);
  newPlaylistDialog.addEventListener('close', () => { pendingPlaylistTrackId = null; });
  newPlaylistNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitNewPlaylist();
  });
}

function openNewPlaylistModal(trackId) {
  pendingPlaylistTrackId = trackId;
  newPlaylistNameInput.value = '';
  newPlaylistDialog.showModal();
  setTimeout(() => newPlaylistNameInput.focus(), 100);
}

function closeNewPlaylistModal() {
  newPlaylistDialog.close();
  pendingPlaylistTrackId = null;
}

async function submitNewPlaylist() {
  const name = newPlaylistNameInput.value.trim();
  if (!name) return;

  try {
    const res = await fetch('/api/playlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    if (!res.ok) throw new Error('Failed to create playlist');
    const playlist = await res.json();
    await loadPlaylists();
    closeNewPlaylistModal();

    if (pendingPlaylistTrackId) {
      await addTrackToPlaylist(playlist.id, pendingPlaylistTrackId);
      pendingPlaylistTrackId = null;
      renderTracksTable();
    } else {
      selectPlaylist(playlist.id);
    }
  } catch (err) {
    console.error('Create playlist error:', err);
    alert('Failed to create playlist.');
  }
}

function stopPlaylistPolling() {}

async function loadPlaylists() {
  try {
    const res = await fetch('/api/playlists');
    playlists = await res.json();
    renderPlaylistList();
  } catch (err) {
    console.error('Failed to load playlists:', err);
  }
}

function renderPlaylistList() {
  playlistList.innerHTML = '';

  if (playlists.length === 0) {
    playlistList.innerHTML = '<div class="playlist-empty"><p>No playlists yet. Click "New Playlist" to create one.</p></div>';
    return;
  }

  playlists.forEach(p => {
    const div = document.createElement('div');
    div.className = `playlist-list-item${selectedPlaylistId === p.id ? ' active' : ''}`;
    div.dataset.playlistId = p.id;
    div.innerHTML = `
      <div class="playlist-list-item-info">
        <div class="playlist-list-item-name">${escapeHTML(p.name)}</div>
        <div class="playlist-list-item-count">${p.trackCount} track${p.trackCount === 1 ? '' : 's'}</div>
      </div>
    `;
    div.addEventListener('click', () => selectPlaylist(p.id));
    playlistList.appendChild(div);
  });
}

async function selectPlaylist(id) {
  selectedPlaylistId = id;
  renderPlaylistList();

  try {
    const res = await fetch(`/api/playlists/${id}`);
    if (!res.ok) throw new Error('Failed to load playlist');
    const data = await res.json();

    playlistDetail.classList.remove('hidden');
    playlistDetailTitle.textContent = data.name;
    playlistDetailName.value = data.name;
    renderPlaylistTracks(data.tracks || []);
  } catch (err) {
    console.error('Select playlist error:', err);
  }
}

/* ==========================================================================
   Playlist Tracks Render
   ========================================================================== */
function renderPlaylistTracks(tracks) {
  playlistTracksTbody.innerHTML = '';

  if (tracks.length === 0) {
    playlistTracksTbody.innerHTML = `
      <tr class="empty-state">
        <td colspan="5">
          <div class="empty-state-content">
            <p>This playlist is empty. Add tracks from the Master tab.</p>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  tracks.forEach((track, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="text-center" style="font-family:var(--font-mono);color:var(--text-muted)">${idx + 1}</td>
      <td>${escapeHTML(track.title)}</td>
      <td>${escapeHTML(track.artist)}</td>
      <td class="text-right" style="font-family:var(--font-mono)">${formatTime(track.duration)}</td>
      <td class="text-center">
        <button class="delete-btn playlist-remove-btn" data-track-id="${track.id}" title="Remove from playlist">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </td>
    `;
    const removeBtn = tr.querySelector('.playlist-remove-btn');
    removeBtn.addEventListener('click', () => removeTrackFromPlaylist(track.id));
    playlistTracksTbody.appendChild(tr);
  });
}

async function removeTrackFromPlaylist(trackId) {
  if (!selectedPlaylistId) return;
  try {
    const res = await fetch(`/api/playlists/${selectedPlaylistId}/tracks/${trackId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to remove track');
    await loadPlaylists();
    selectPlaylist(selectedPlaylistId);
    fetchTracks(); // re-render master track list to show updated playlist badges
  } catch (err) {
    console.error('Remove track error:', err);
  }
}

async function deleteSelectedPlaylist() {
  if (!selectedPlaylistId) return;
  if (!confirm('Delete this playlist? Tracks will not be deleted.')) return;

  try {
    const res = await fetch(`/api/playlists/${selectedPlaylistId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete playlist');
    selectedPlaylistId = null;
    playlistDetail.classList.add('hidden');
    await loadPlaylists();
  } catch (err) {
    console.error('Delete playlist error:', err);
  }
}

async function renameSelectedPlaylist() {
  if (!selectedPlaylistId) return;
  const name = playlistDetailName.value.trim();
  if (!name) return;

  try {
    await fetch(`/api/playlists/${selectedPlaylistId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    playlistDetailTitle.textContent = name;
    await loadPlaylists();
  } catch (err) {
    console.error('Rename playlist error:', err);
  }
}

async function burnSelectedPlaylist() {
  if (!selectedPlaylistId) return;
  try {
    const res = await fetch(`/api/playlists/${selectedPlaylistId}/burn`, { method: 'POST' });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to load playlist');
    }
    const playlistTracks = await res.json();
    // Replace local tracks with playlist tracks
    localTracks = playlistTracks;
    renderTracksTable();
    // Switch to Master tab
    tabMaster.click();
  } catch (err) {
    console.error('Burn playlist error:', err);
    alert(err.message);
  }
}

async function addTrackToPlaylist(playlistId, trackId) {
  try {
    const res = await fetch(`/api/playlists/${playlistId}/tracks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trackId })
    });
    if (!res.ok) throw new Error('Failed to add track');
    await loadPlaylists();
    if (selectedPlaylistId === playlistId) {
      selectPlaylist(playlistId);
    }
  } catch (err) {
    console.error('Add track error:', err);
  }
}

function setupPlaylistDropdowns() {
  document.addEventListener('click', (e) => {
    const toggle = e.target.closest('.playlist-dropdown-toggle');
    if (toggle) {
      e.preventDefault();
      e.stopPropagation();
      const dropdown = toggle.closest('.playlist-dropdown');
      if (!dropdown) return;
      const menu = dropdown.querySelector('.playlist-dropdown-menu');
      const isOpen = !menu.classList.contains('hidden');
      closeAllPlaylistDropdowns();
      if (!isOpen) openPlaylistDropdown(dropdown, menu);
      return;
    }

    const item = e.target.closest('.playlist-dropdown-item');
    if (item) {
      e.preventDefault();
      const dropdown = item.closest('.playlist-dropdown');
      if (!dropdown) return;
      const trackId = dropdown.dataset.trackId;
      const playlistId = item.dataset.playlistId;
      if (!playlistId) return;
      addTrackToPlaylist(playlistId, trackId);
      closeAllPlaylistDropdowns();
      showPlaylistAddedFeedback(dropdown);
      return;
    }

    const newItem = e.target.closest('.playlist-dropdown-new');
    if (newItem) {
      e.preventDefault();
      const dropdown = newItem.closest('.playlist-dropdown');
      const trackId = dropdown?.dataset.trackId;
      closeAllPlaylistDropdowns();
      openNewPlaylistModal(trackId);
      return;
    }

    closeAllPlaylistDropdowns();
  });
}

function closeAllPlaylistDropdowns() {
  document.querySelectorAll('.playlist-dropdown-menu').forEach(m => m.classList.add('hidden'));
}

function openPlaylistDropdown(dropdown, menu) {
  menu.innerHTML = '';
  const isEmpty = playlists.length === 0;

  if (isEmpty) {
    const item = document.createElement('div');
    item.className = 'playlist-dropdown-item playlist-dropdown-new';
    item.textContent = '+ New Playlist';
    menu.appendChild(item);
  } else {
    playlists.forEach(p => {
      const item = document.createElement('div');
      item.className = 'playlist-dropdown-item';
      item.dataset.playlistId = p.id;
      item.innerHTML = `
        <span class="playlist-dd-name">${escapeHTML(p.name)}</span>
        <span class="playlist-dd-count">${p.trackCount}</span>
      `;
      menu.appendChild(item);
    });
    const divider = document.createElement('div');
    divider.className = 'playlist-dropdown-divider';
    menu.appendChild(divider);
    const newItem = document.createElement('div');
    newItem.className = 'playlist-dropdown-item playlist-dropdown-new';
    newItem.textContent = '+ New Playlist';
    menu.appendChild(newItem);
  }

  menu.classList.remove('hidden');
}

function showPlaylistAddedFeedback(dropdown) {
  const toggle = dropdown.querySelector('.playlist-dropdown-toggle');
  toggle.innerHTML = '<span style="font-size:0.65rem;color:var(--state-success);font-weight:700;">✓</span>';
  toggle.classList.add('added');
  setTimeout(() => {
    toggle.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>`;
    toggle.classList.remove('added');
  }, 1200);
}

/* ==========================================================================
   Spotify Search & Download
   ========================================================================== */

async function performSearch() {
  const query = searchInput.value.trim();
  if (!query) return;

  searchError.classList.add('hidden');
  searchResults.classList.add('hidden');
  searchResults.innerHTML = '';
  searchSpinner.classList.remove('hidden');
  searchBtn.disabled = true;

  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Search failed');
    }

    const results = await res.json();
    renderSearchResults(results);
  } catch (err) {
    searchError.textContent = `Search error: ${err.message}`;
    searchError.classList.remove('hidden');
    console.error('Search error:', err);
  } finally {
    searchSpinner.classList.add('hidden');
    searchBtn.disabled = false;
  }
}

function renderSearchResults(results) {
  searchResults.innerHTML = '';

  if (results.length === 0) {
    searchResults.innerHTML = `<div class="search-empty">No results found. Try a different search term.</div>`;
    searchResults.classList.remove('hidden');
    return;
  }

  const list = document.createElement('div');
  list.className = 'search-result-list';

  results.forEach(track => {
    const item = document.createElement('div');
    item.className = 'search-result-item';

    const artUrl = track.albumArt || '';
    const artHtml = artUrl
      ? `<img class="search-result-art" src="${escapeHTML(artUrl)}" alt="" loading="lazy">`
      : `<div class="search-result-art search-result-art-placeholder">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/>
          </svg>
        </div>`;

    item.innerHTML = `
      ${artHtml}
      <div class="search-result-info">
        <div class="search-result-title">${escapeHTML(track.title)}</div>
        <div class="search-result-artist">${escapeHTML(track.artist)}</div>
        <div class="search-result-meta">
          <span>${escapeHTML(track.album)}</span>
          <span class="sep">·</span>
          <span>${formatTime(track.duration)}</span>
        </div>
      </div>
      <button class="btn btn-sm btn-spotify btn-download-track"
              data-spotify-url="${escapeHTML(track.spotifyUrl)}"
              data-title="${escapeHTML(track.title)}"
              data-artist="${escapeHTML(track.artist)}"
              data-album="${escapeHTML(track.album)}"
              data-duration="${track.duration}">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        Add to Queue
      </button>
    `;

    const addBtn = item.querySelector('.btn-download-track');
    addBtn.addEventListener('click', (e) => downloadTrack(addBtn.dataset, addBtn));

    list.appendChild(item);
  });

  searchResults.appendChild(list);
  searchResults.classList.remove('hidden');
}

async function downloadTrack(data, btn) {
  if (isDownloading) return;
  isDownloading = true;

  btn.disabled = true;
  btn.textContent = 'Downloading...';

  try {
    const res = await fetch('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spotifyUrl: data.spotifyUrl,
        title: data.title,
        artist: data.artist,
        album: data.album,
        duration: parseInt(data.duration)
      })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Download failed');
    }

    fetchTracks();

    btn.disabled = true;
    btn.textContent = 'Added ✓';
    btn.classList.remove('btn-spotify');
    btn.classList.add('btn-added');
  } catch (err) {
    console.error('Download error:', err);
    alert(`Download failed: ${err.message}`);
    btn.disabled = false;
    btn.textContent = 'Add to Queue';
  } finally {
    isDownloading = false;
  }
}

/* ==========================================================================
   Scroll Affordance Sentinels Observer Fallback
   ========================================================================== */
function setupScrollAffordances() {
  const scroller = document.getElementById('track-scroller');
  const sentinelTop = scroller.querySelector('.sentinel-top');
  const sentinelBottom = scroller.querySelector('.sentinel-bottom');

  if (!sentinelTop || !sentinelBottom) return;

  // Utilize CSS Container scrollable queries if natively supported
  if (CSS.supports('container-type', 'scroll-state')) {
    console.log('Browser supports native CSS container-scrollable state queries.');
    return;
  }

  // Fallback observer
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.target === sentinelTop) {
        scroller.classList.toggle('scrolled-down', !entry.isIntersecting);
      }
      if (entry.target === sentinelBottom) {
        scroller.classList.toggle('can-scroll-down', !entry.isIntersecting);
      }
    });
  }, { root: scroller });

  observer.observe(sentinelTop);
  observer.observe(sentinelBottom);
}

/* ==========================================================================
   Formatting & Visual Utilities
   ========================================================================== */

// Format float seconds to MM:SS
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// Format bytes size to Human readable string
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Safe string escaping for HTML rendering
function escapeHTML(str) {
  return str.replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}

// Update top header status text
function showStatusText(text, isOnline) {
  const textEl = document.getElementById('status-text');
  const indicator = document.querySelector('.status-indicator');
  
  textEl.textContent = text;
  if (isOnline) {
    indicator.className = 'status-indicator online';
  } else {
    indicator.className = 'status-indicator offline';
  }
}

// Scroll log pre container to bottom
function scrollConsoleToBottom() {
  consoleLog.scrollTop = consoleLog.scrollHeight;
}
