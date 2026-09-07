'use strict';

const { createGameServer } = require('./src/gameServer');

const PORT = Number(process.env.PORT || 3000);
const { httpServer } = createGameServer();

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Flag Pinpoint listening on http://0.0.0.0:${PORT}`);
});
