module.exports = {
  apps: [{
    name: 'fmb-timetracker',
    script: 'dist/index.js',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
      HOST: '0.0.0.0',
      FMB_DEPLOYMENT: 'onprem'
    },
    instances: 1,
    exec_mode: 'cluster',
    watch: false,
    max_memory_restart: '2G',
    log_file: 'logs/combined.log',
    out_file: 'logs/out.log',
    error_file: 'logs/error.log',
    time: true,
    merge_logs: true,
    windows_hide: true,
    restart_delay: 5000,
    max_restarts: 10,
    min_uptime: '10s'
  }]
};