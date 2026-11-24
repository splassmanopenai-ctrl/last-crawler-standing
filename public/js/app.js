// Start-up: draw the current screen and, if this phone has a seat, reconnect to it.
document.addEventListener('visibilitychange', () => { if (!document.hidden && session && es && es.readyState === 2) connect(); });
render();
if (session || tv) connect();
