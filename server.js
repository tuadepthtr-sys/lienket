// AutoSell Mod - Real-time Web Dashboard & Remote Control Server
// Pure Node.js implementation (Zero dependencies, instant deployment on Render.com)

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// Global In-Memory State
const state = {
  accounts: {},
  alerts: [],
  globalStats: {
    totalEarned: 0,
    totalSales: 0,
    startTime: Date.now()
  },
  // Remote Command Queue: { [accountName]: [ { id, command, time } ] }
  commandQueue: {},
  commandHistory: []
};

// Connected SSE clients
const sseClients = new Set();

function broadcastEvent(type, data) {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch (e) {
      sseClients.delete(client);
    }
  }
}

// Keep SSE alive every 20 seconds to prevent Render.com proxy timeouts
setInterval(() => {
  for (const client of sseClients) {
    try {
      client.write(': keep-alive\n\n');
    } catch (e) {
      sseClients.delete(client);
    }
  }
}, 20000);

// Helper to parse JSON body
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1e6) { // 1MB limit
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

// MIME types
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer(async (req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // 1. SSE Stream Endpoint
  if (pathname === '/api/events' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive'
    });
    res.write(`event: init\ndata: ${JSON.stringify({
      accounts: state.accounts,
      alerts: state.alerts,
      globalStats: state.globalStats,
      commandHistory: state.commandHistory.slice(0, 30)
    })}\n\n`);
    sseClients.add(res);

    req.on('close', () => {
      sseClients.delete(res);
    });
    return;
  }

  // 2. State Snapshot API
  if (pathname === '/api/state' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(state));
    return;
  }

  // 3. Heartbeat Endpoint (Mod calls this, and receives pending commands)
  if (pathname === '/api/heartbeat' && req.method === 'POST') {
    try {
      const data = await parseJsonBody(req);
      const name = data.account || 'Unknown';
      state.accounts[name] = {
        account: name,
        server: data.server || 'Unknown',
        health: data.health !== undefined ? data.health : 20,
        maxHealth: data.maxHealth || 20,
        food: data.food !== undefined ? data.food : 20,
        state: data.state || 'ONLINE', // FARMING, SELLING, WAITING_10M, DEAD, PAUSED, ONLINE
        details: data.details || '',
        pos: data.pos || '',
        totalEarned: data.totalEarned || 0,
        salesCount: data.salesCount || 0,
        uptime: data.uptime || '00:00:00',
        reconnectCountdown: data.reconnectCountdown || 0,
        linkedAccount: data.linkedAccount || '',
        lastSeen: Date.now()
      };

      // Recalculate totals
      let totalEarned = 0;
      let totalSales = 0;
      for (const acc of Object.values(state.accounts)) {
        totalEarned += (acc.totalEarned || 0);
        totalSales += (acc.salesCount || 0);
      }
      state.globalStats.totalEarned = totalEarned;
      state.globalStats.totalSales = totalSales;

      broadcastEvent('heartbeat', state.accounts[name]);
      broadcastEvent('globalStats', state.globalStats);

      // Collect pending commands for this account
      const pending = [];
      if (state.commandQueue[name] && state.commandQueue[name].length > 0) {
        pending.push(...state.commandQueue[name]);
        delete state.commandQueue[name];
      }
      if (state.commandQueue['all'] && state.commandQueue['all'].length > 0) {
        pending.push(...state.commandQueue['all']);
      }

      const commandsToExecute = pending.map(item => item.command);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        pendingCommands: commandsToExecute
      }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // 4. Remote Command Enqueue Endpoint (Web calls this to send commands)
  if (pathname === '/api/command' && req.method === 'POST') {
    try {
      const data = await parseJsonBody(req);
      const target = data.target || 'all';
      let cmd = (data.command || '').trim();

      if (!cmd) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Command cannot be empty' }));
        return;
      }

      // Ensure command format
      if (cmd.startsWith('/')) {
        cmd = cmd.substring(1).trim();
      }

      const cmdItem = {
        id: Date.now() + '-' + Math.random().toString(36).substr(2, 5),
        target: target,
        command: cmd,
        timestamp: Date.now(),
        status: 'queued'
      };

      if (!state.commandQueue[target]) {
        state.commandQueue[target] = [];
      }
      state.commandQueue[target].push(cmdItem);

      state.commandHistory.unshift(cmdItem);
      if (state.commandHistory.length > 50) {
        state.commandHistory.pop();
      }

      broadcastEvent('commandQueued', cmdItem);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', item: cmdItem }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // 5. Command Result Callback Endpoint (Mod reports execution feedback)
  if (pathname === '/api/command-result' && req.method === 'POST') {
    try {
      const data = await parseJsonBody(req);
      const resultItem = {
        account: data.account || 'Mod',
        command: data.command || '',
        success: data.success !== undefined ? data.success : true,
        message: data.message || 'Lệnh đã thực thi trong game',
        timestamp: Date.now()
      };

      broadcastEvent('commandResult', resultItem);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // 6. Detection Alert Endpoint
  if (pathname === '/api/detection' && req.method === 'POST') {
    try {
      const data = await parseJsonBody(req);
      const alertItem = {
        id: Date.now() + '-' + Math.random().toString(36).substr(2, 5),
        account: data.account || 'Mod',
        detectedPlayer: data.detectedPlayer || 'Unknown',
        distance: data.distance || 0,
        server: data.server || 'Unknown',
        myPos: data.myPos || '',
        targetPos: data.targetPos || '',
        channel: data.channel || 'WhitelistGuard',
        timestamp: Date.now()
      };

      // Keep last 50 alerts
      state.alerts.unshift(alertItem);
      if (state.alerts.length > 50) {
        state.alerts.pop();
      }

      broadcastEvent('detection', alertItem);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', alert: alertItem }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // 7. Stats Endpoint
  if (pathname === '/api/stats' && req.method === 'POST') {
    try {
      const data = await parseJsonBody(req);
      const name = data.account || 'Player';
      if (state.accounts[name]) {
        state.accounts[name].totalEarned = data.totalEarned || state.accounts[name].totalEarned;
        state.accounts[name].salesCount = data.salesCount || state.accounts[name].salesCount;
      }
      broadcastEvent('stats', data);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // 8. Test Endpoint
  if (pathname === '/api/test' && (req.method === 'POST' || req.method === 'GET')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      message: 'Web Dashboard is running!',
      timestamp: Date.now(),
      connectedClients: sseClients.size
    }));
    return;
  }

  // 9. Clear Data Endpoint
  if (pathname === '/api/clear' && req.method === 'POST') {
    state.accounts = {};
    state.alerts = [];
    state.globalStats.totalEarned = 0;
    state.globalStats.totalSales = 0;
    state.commandQueue = {};
    state.commandHistory = [];
    broadcastEvent('clear', {});
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'cleared' }));
    return;
  }

  // 10. Serve Static Files from public/
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  const ext = path.extname(filePath).toLowerCase();

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Fallback to index.html for SPA
      filePath = path.join(PUBLIC_DIR, 'index.html');
    }
    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found');
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'text/plain' });
      res.end(content);
    });
  });
});

server.listen(PORT, () => {
  console.log(`=================================================`);
  console.log(` AutoSell Web Dashboard & Remote Server Running!`);
  console.log(` Local URL:   http://localhost:${PORT}          `);
  console.log(` Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`=================================================`);
});
