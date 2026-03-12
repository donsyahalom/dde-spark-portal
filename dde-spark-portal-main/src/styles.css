*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg: #26643F;
  --bg-dark: #1a4a2e;
  --bg-darker: #112e1c;
  --bg-card: rgba(0,0,0,0.35);
  --bg-card-hover: rgba(0,0,0,0.5);
  --gold: #F0C040;
  --gold-light: #FFD966;
  --gold-dark: #C49A20;
  --gold-glow: rgba(240,192,64,0.4);
  --white: #FFFFFF;
  --white-soft: rgba(255,255,255,0.85);
  --white-dim: rgba(255,255,255,0.55);
  --white-faint: rgba(255,255,255,0.1);
  --red: #E05555;
  --green-bright: #5EE88A;
  --border: rgba(240,192,64,0.25);
  --border-bright: rgba(240,192,64,0.6);
  --font-display: 'Cinzel', serif;
  --font-body: 'Lato', sans-serif;
  --radius: 12px;
  --radius-sm: 8px;
  --transition: 0.2s ease;
  --shadow: 0 4px 24px rgba(0,0,0,0.4);
  --shadow-gold: 0 0 20px rgba(240,192,64,0.3);
}

html, body, #root {
  height: 100%;
  font-family: var(--font-body);
  background: var(--bg-darker);
  color: var(--white);
}

body {
  background: 
    radial-gradient(ellipse at top left, rgba(240,192,64,0.08) 0%, transparent 50%),
    radial-gradient(ellipse at bottom right, rgba(38,100,63,0.6) 0%, transparent 60%),
    var(--bg-darker);
  min-height: 100vh;
}

/* Scrollbar */
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: var(--bg-darker); }
::-webkit-scrollbar-thumb { background: var(--gold-dark); border-radius: 3px; }

/* Loading */
.loading-screen {
  display: flex; align-items: center; justify-content: center;
  height: 100vh; background: var(--bg-darker);
}
.spark-loader {
  width: 48px; height: 48px;
  border: 3px solid var(--border);
  border-top-color: var(--gold);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* Layout */
.app-layout { display: flex; flex-direction: column; min-height: 100vh; }

/* Header */
.header {
  background: linear-gradient(135deg, var(--bg-darker) 0%, var(--bg-dark) 100%);
  border-bottom: 1px solid var(--border-bright);
  padding: 0 24px;
  display: flex; align-items: center; justify-content: space-between;
  height: 70px;
  position: sticky; top: 0; z-index: 100;
  box-shadow: 0 2px 20px rgba(0,0,0,0.5);
}
.header-left { display: flex; align-items: center; gap: 16px; }
.header-logo { height: 48px; width: auto; }
.header-title {
  font-family: var(--font-display);
  font-size: clamp(1rem, 3vw, 1.4rem);
  font-weight: 700;
  color: var(--gold);
  text-shadow: 0 0 20px var(--gold-glow);
  letter-spacing: 0.05em;
  white-space: nowrap;
}
.header-nav { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.nav-btn {
  background: transparent; border: 1px solid transparent;
  color: var(--white-dim); font-family: var(--font-display);
  font-size: 0.7rem; letter-spacing: 0.1em; text-transform: uppercase;
  padding: 8px 14px; border-radius: var(--radius-sm); cursor: pointer;
  transition: all var(--transition); text-decoration: none; display: inline-block;
}
.nav-btn:hover, .nav-btn.active {
  color: var(--gold); border-color: var(--border-bright);
  background: var(--white-faint);
}
.nav-btn.logout { color: var(--white-dim); }
.nav-btn.logout:hover { color: var(--red); border-color: rgba(224,85,85,0.4); }
.user-badge {
  font-size: 0.75rem; color: var(--white-dim);
  display: flex; align-items: center; gap: 6px;
}
.user-badge .spark-count { color: var(--gold); font-weight: 700; }

/* Main content */
.main-content { flex: 1; padding: 24px; max-width: 1200px; margin: 0 auto; width: 100%; }

/* Cards */
.card {
  background: var(--bg-card); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 24px; backdrop-filter: blur(10px);
  box-shadow: var(--shadow);
}
.card-title {
  font-family: var(--font-display); font-size: 1.1rem;
  color: var(--gold); letter-spacing: 0.08em; margin-bottom: 20px;
  display: flex; align-items: center; gap: 10px;
}
.card-title .icon { font-size: 1.3rem; }

/* Page titles */
.page-title {
  font-family: var(--font-display); font-size: clamp(1.4rem, 4vw, 2rem);
  color: var(--gold); font-weight: 700; letter-spacing: 0.05em;
  margin-bottom: 8px; text-shadow: 0 0 30px var(--gold-glow);
}
.page-subtitle { color: var(--white-dim); margin-bottom: 28px; font-size: 0.9rem; }

/* Buttons */
.btn {
  font-family: var(--font-display); font-size: 0.75rem; letter-spacing: 0.1em;
  text-transform: uppercase; padding: 10px 20px; border-radius: var(--radius-sm);
  border: none; cursor: pointer; transition: all var(--transition); font-weight: 600;
  display: inline-flex; align-items: center; gap: 6px;
}
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-gold {
  background: linear-gradient(135deg, var(--gold) 0%, var(--gold-dark) 100%);
  color: var(--bg-darker);
  box-shadow: 0 2px 12px rgba(240,192,64,0.3);
}
.btn-gold:hover:not(:disabled) {
  box-shadow: 0 4px 20px rgba(240,192,64,0.5);
  transform: translateY(-1px);
}
.btn-outline {
  background: transparent; color: var(--gold);
  border: 1px solid var(--border-bright);
}
.btn-outline:hover:not(:disabled) { background: var(--white-faint); }
.btn-danger { background: var(--red); color: var(--white); }
.btn-danger:hover:not(:disabled) { background: #c03333; }
.btn-sm { padding: 6px 14px; font-size: 0.68rem; }
.btn-xs { padding: 4px 10px; font-size: 0.62rem; }

/* Inputs */
.form-group { margin-bottom: 16px; }
.form-label {
  display: block; font-size: 0.75rem; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--white-dim); margin-bottom: 6px;
}
.form-input, .form-select, .form-textarea {
  width: 100%; background: rgba(0,0,0,0.4); border: 1px solid var(--border);
  border-radius: var(--radius-sm); color: var(--white); font-family: var(--font-body);
  font-size: 0.9rem; padding: 10px 14px; outline: none; transition: border-color var(--transition);
}
.form-input:focus, .form-select:focus, .form-textarea:focus {
  border-color: var(--gold); box-shadow: 0 0 0 2px rgba(240,192,64,0.1);
}
.form-input::placeholder { color: var(--white-dim); }
.form-select option { background: var(--bg-darker); color: var(--white); }
.form-textarea { resize: vertical; min-height: 100px; }
.form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; }

/* Tables */
.table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
table { width: 100%; border-collapse: collapse; }
th {
  font-family: var(--font-display); font-size: 0.7rem; letter-spacing: 0.1em;
  text-transform: uppercase; color: var(--gold); padding: 12px 14px;
  border-bottom: 1px solid var(--border-bright); text-align: left; white-space: nowrap;
}
td {
  padding: 12px 14px; border-bottom: 1px solid var(--border);
  font-size: 0.88rem; vertical-align: middle;
}
tr:last-child td { border-bottom: none; }
tr:hover td { background: var(--white-faint); }

/* Spark badge */
.spark-badge {
  display: inline-flex; align-items: center; gap: 4px;
  background: linear-gradient(135deg, rgba(240,192,64,0.2), rgba(240,192,64,0.05));
  border: 1px solid var(--border-bright); border-radius: 20px;
  padding: 3px 10px; font-family: var(--font-display); font-size: 0.8rem;
  color: var(--gold); font-weight: 700;
}
.spark-badge .star { color: var(--gold-light); }

/* Rank badge */
.rank-badge {
  display: inline-flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; border-radius: 50%; font-weight: 700;
  font-size: 0.85rem; font-family: var(--font-display);
}
.rank-1 { background: linear-gradient(135deg, #FFD700, #B8860B); color: #000; box-shadow: 0 0 12px rgba(255,215,0,0.5); }
.rank-2 { background: linear-gradient(135deg, #C0C0C0, #808080); color: #000; }
.rank-3 { background: linear-gradient(135deg, #CD7F32, #8B4513); color: #fff; }
.rank-other { background: var(--white-faint); color: var(--white-dim); border: 1px solid var(--border); }

/* Leaderboard */
.leaderboard-row { display: flex; align-items: center; gap: 16px; padding: 14px 0; border-bottom: 1px solid var(--border); }
.leaderboard-row:last-child { border-bottom: none; }
.leaderboard-name { flex: 1; font-weight: 700; font-size: 1rem; }
.leaderboard-sparks { font-family: var(--font-display); color: var(--gold); font-weight: 700; font-size: 1.1rem; }

/* Progress bar */
.progress-bar { background: rgba(0,0,0,0.4); border-radius: 10px; height: 6px; overflow: hidden; margin-top: 6px; }
.progress-fill { height: 100%; background: linear-gradient(90deg, var(--gold-dark), var(--gold)); border-radius: 10px; transition: width 0.5s ease; }

/* Tabs */
.tabs { display: flex; gap: 4px; margin-bottom: 24px; border-bottom: 1px solid var(--border); overflow-x: auto; }
.tab-btn {
  font-family: var(--font-display); font-size: 0.7rem; letter-spacing: 0.1em;
  text-transform: uppercase; padding: 10px 18px; background: transparent;
  border: none; color: var(--white-dim); cursor: pointer; transition: all var(--transition);
  border-bottom: 2px solid transparent; margin-bottom: -1px; white-space: nowrap;
}
.tab-btn.active { color: var(--gold); border-bottom-color: var(--gold); }
.tab-btn:hover { color: var(--white); }

/* Alerts */
.alert { padding: 12px 16px; border-radius: var(--radius-sm); margin-bottom: 16px; font-size: 0.88rem; }
.alert-success { background: rgba(94,232,138,0.15); border: 1px solid rgba(94,232,138,0.3); color: var(--green-bright); }
.alert-error { background: rgba(224,85,85,0.15); border: 1px solid rgba(224,85,85,0.3); color: var(--red); }
.alert-warning { background: rgba(240,192,64,0.15); border: 1px solid var(--border-bright); color: var(--gold); }

/* Login page */
.login-page {
  min-height: 100vh; display: flex; align-items: center; justify-content: center;
  padding: 20px;
  background: 
    radial-gradient(ellipse at 30% 20%, rgba(240,192,64,0.12) 0%, transparent 50%),
    radial-gradient(ellipse at 70% 80%, rgba(38,100,63,0.5) 0%, transparent 50%),
    var(--bg-darker);
}
.login-box {
  background: rgba(0,0,0,0.5); border: 1px solid var(--border-bright);
  border-radius: 20px; padding: clamp(28px, 5vw, 48px);
  width: 100%; max-width: 420px; backdrop-filter: blur(20px);
  box-shadow: 0 20px 60px rgba(0,0,0,0.6), var(--shadow-gold);
}
.login-logo { display: block; height: 80px; margin: 0 auto 24px; }
.login-title {
  font-family: var(--font-display); font-size: clamp(1.2rem, 4vw, 1.6rem);
  color: var(--gold); text-align: center; letter-spacing: 0.1em; margin-bottom: 8px;
}
.login-subtitle { color: var(--white-dim); text-align: center; font-size: 0.85rem; margin-bottom: 32px; }

/* Stat cards */
.stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 16px; margin-bottom: 24px; }
.stat-card {
  background: rgba(0,0,0,0.3); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 16px; text-align: center;
}
.stat-value { font-family: var(--font-display); font-size: 2rem; color: var(--gold); font-weight: 700; }
.stat-label { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--white-dim); margin-top: 4px; }

/* Sort control */
.sort-control { display: flex; align-items: center; gap: 10px; margin-bottom: 20px; flex-wrap: wrap; }
.sort-label { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--white-dim); }
.sort-btn {
  font-size: 0.75rem; padding: 6px 14px; border-radius: 20px;
  background: transparent; border: 1px solid var(--border);
  color: var(--white-dim); cursor: pointer; transition: all var(--transition);
  font-family: var(--font-body);
}
.sort-btn.active { background: rgba(240,192,64,0.15); border-color: var(--border-bright); color: var(--gold); }
.sort-btn:hover { color: var(--gold); }

/* Inline edit */
.inline-edit { display: flex; align-items: center; gap: 6px; }
.inline-input {
  background: rgba(0,0,0,0.5); border: 1px solid var(--gold-dark); border-radius: 4px;
  color: var(--white); padding: 4px 8px; font-size: 0.85rem; width: 80px;
  outline: none;
}

/* Divider */
.divider { border: none; border-top: 1px solid var(--border); margin: 20px 0; }

/* Empty state */
.empty-state { text-align: center; padding: 40px 20px; color: var(--white-dim); }
.empty-state .icon { font-size: 3rem; margin-bottom: 12px; opacity: 0.5; }

/* Chip */
.chip {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 10px; border-radius: 20px; font-size: 0.72rem;
  letter-spacing: 0.06em; text-transform: uppercase; font-weight: 700;
}
.chip-green { background: rgba(94,232,138,0.2); color: var(--green-bright); border: 1px solid rgba(94,232,138,0.3); }
.chip-gold { background: rgba(240,192,64,0.2); color: var(--gold); border: 1px solid var(--border-bright); }
.chip-red { background: rgba(224,85,85,0.2); color: var(--red); border: 1px solid rgba(224,85,85,0.3); }

/* Modal overlay */
.modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.7);
  display: flex; align-items: center; justify-content: center;
  z-index: 200; padding: 20px; backdrop-filter: blur(4px);
}
.modal {
  background: var(--bg-dark); border: 1px solid var(--border-bright);
  border-radius: 16px; padding: 28px; width: 100%; max-width: 500px;
  max-height: 90vh; overflow-y: auto;
  box-shadow: 0 20px 60px rgba(0,0,0,0.6);
}
.modal-title { font-family: var(--font-display); color: var(--gold); font-size: 1.1rem; margin-bottom: 20px; }

/* Responsive */
@media (max-width: 768px) {
  .header { padding: 0 14px; height: 60px; }
  .header-logo { height: 36px; }
  .header-title { font-size: 0.9rem; }
  .header-nav { gap: 4px; }
  .nav-btn { padding: 6px 10px; font-size: 0.62rem; }
  .main-content { padding: 16px; }
  .card { padding: 16px; }
  th, td { padding: 10px 10px; font-size: 0.82rem; }
  .stat-value { font-size: 1.5rem; }
  .form-grid { grid-template-columns: 1fr; }
  .tabs { gap: 0; }
  .tab-btn { padding: 8px 12px; font-size: 0.65rem; }
}

@media (max-width: 480px) {
  .header-title { display: none; }
  .leaderboard-name { font-size: 0.9rem; }
}

/* Animations */
@keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
.fade-in { animation: fadeIn 0.3s ease forwards; }
@keyframes sparkle {
  0%, 100% { transform: scale(1) rotate(0deg); opacity: 1; }
  50% { transform: scale(1.2) rotate(180deg); opacity: 0.8; }
}
.star-icon { display: inline-block; animation: sparkle 2s ease infinite; }

/* Date range inputs */
.date-range { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.date-range input[type="date"] {
  background: rgba(0,0,0,0.4); border: 1px solid var(--border);
  border-radius: var(--radius-sm); color: var(--white);
  padding: 8px 12px; font-family: var(--font-body); outline: none;
  transition: border-color var(--transition);
}
.date-range input[type="date"]:focus { border-color: var(--gold); }
.date-range input[type="date"]::-webkit-calendar-picker-indicator { filter: invert(1) sepia(1) saturate(3) hue-rotate(10deg); }
