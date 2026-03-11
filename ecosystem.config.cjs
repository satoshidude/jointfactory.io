module.exports = {
  apps: [{
    name: 'jointfactory',
    script: './server/index.js',
    cwd: '/home/webmaster/jointfactory.io',
    env: {
      NODE_ENV: 'production',
      PORT: 3421,
    },
    max_memory_restart: '256M',
    autorestart: true,
  }]
};
