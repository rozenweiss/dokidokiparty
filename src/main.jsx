import React from "react";
import ReactDOM from "react-dom/client";
import GuildPartyMatcher from "./GuildPartyMatcher";

window.onerror = function(msg, url, lineNo, columnNo, error) {
  const errDiv = document.createElement('div');
  errDiv.style.cssText = 'position:fixed;top:0;left:0;right:0;background:red;color:white;padding:20px;z-index:9999;font-family:monospace;white-space:pre-wrap;';
  errDiv.innerHTML = `<strong>Runtime Error:</strong>\n${msg}\n${error?.stack || ''}`;
  document.body.appendChild(errDiv);
};
window.addEventListener('unhandledrejection', function(event) {
  const errDiv = document.createElement('div');
  errDiv.style.cssText = 'position:fixed;top:0;left:0;right:0;background:orange;color:black;padding:20px;z-index:9998;font-family:monospace;white-space:pre-wrap;';
  errDiv.innerHTML = `<strong>Unhandled Promise Rejection:</strong>\n${event.reason?.message || event.reason}\n${event.reason?.stack || ''}`;
  document.body.appendChild(errDiv);
});

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <GuildPartyMatcher />
  </React.StrictMode>
);
