module.exports = {
  apps: [{
    name: 'wa-dealer',
    cwd: '/opt/wa-dealer/backend',
    script: 'src/index.js',
    interpreter: 'node',
    node_args: '--experimental-specifier-resolution=node',
    env: {
      NODE_ENV: 'production',
    },
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    error_file: '/var/log/wa-dealer-error.log',
    out_file: '/var/log/wa-dealer-out.log',
    merge_logs: true,
    time: true,
  }]
};
