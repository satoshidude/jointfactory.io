module.exports = {
  apps: [{
    name: 'jointfactory-v2',
    script: './server/index.js',
    cwd: '/home/webmaster/JointFactoryGame',
    env: {
      NODE_ENV: 'production',
      PORT: 3421,
    }
  }]
};
