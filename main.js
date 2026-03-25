const { app, BrowserWindow } = require("electron");

// 🔥 直接引入你的 server（最穩）
require("./server.js");

let mainWindow;

app.whenReady().then(() => {

  mainWindow = new BrowserWindow({
    width: 1000,
    height: 800,
  });

  // 🔥 多等一點時間（避免還沒啟動）
  setTimeout(() => {
    mainWindow.loadURL("http://localhost:3000");
  }, 3000);

});