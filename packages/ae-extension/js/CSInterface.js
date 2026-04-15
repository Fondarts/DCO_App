/**
 * CSInterface.js - Adobe CEP CSInterface library
 * Compatible with CEP 11.x for After Effects
 */

var SystemPath = {
  USER_DATA: "userData",
  COMMON_FILES: "commonFiles",
  MY_DOCUMENTS: "myDocuments",
  APPLICATION: "application",
  EXTENSION: "extension",
  HOST_APPLICATION: "hostApplication"
};

function CSInterface() {}

/**
 * Evaluates ExtendScript in the host application
 */
CSInterface.prototype.evalScript = function(script, callback) {
  if (callback === null || callback === undefined) {
    callback = function() {};
  }
  window.__adobe_cep__.evalScript(script, callback);
};

/**
 * Returns the system path for the given path type
 */
CSInterface.prototype.getSystemPath = function(pathType) {
  var path = window.__adobe_cep__.getSystemPath(pathType);
  return path;
};

/**
 * Returns host environment information
 */
CSInterface.prototype.getHostEnvironment = function() {
  return JSON.parse(window.__adobe_cep__.getHostEnvironment());
};

/**
 * Registers an event listener for a CSEvent
 */
CSInterface.prototype.addEventListener = function(type, listener, obj) {
  window.__adobe_cep__.addEventListener(type, listener, obj);
};

/**
 * Removes an event listener
 */
CSInterface.prototype.removeEventListener = function(type, listener, obj) {
  window.__adobe_cep__.removeEventListener(type, listener, obj);
};

/**
 * Opens a URL in the default browser
 */
CSInterface.prototype.openURLInDefaultBrowser = function(url) {
  if (typeof cep !== "undefined" && cep.util) {
    cep.util.openURLInDefaultBrowser(url);
  }
};

/**
 * Retrieves network preferences
 */
CSInterface.prototype.getNetworkPreferences = function() {
  try {
    return JSON.parse(window.__adobe_cep__.getNetworkPreferences());
  } catch(e) {
    return {};
  }
};

/**
 * Gets the scale factor of the display
 */
CSInterface.prototype.getScaleFactor = function() {
  try {
    return window.__adobe_cep__.getScaleFactor();
  } catch(e) {
    return 1;
  }
};

/**
 * Dispatches an event
 */
CSInterface.prototype.dispatchEvent = function(event) {
  if (typeof event.data === "undefined") {
    event.data = "";
  }
  try {
    window.__adobe_cep__.dispatchEvent(event);
  } catch(e) {}
};

/**
 * Closes this extension
 */
CSInterface.prototype.closeExtension = function() {
  window.__adobe_cep__.closeExtension();
};

/**
 * Get extensions info
 */
CSInterface.prototype.getExtensions = function(extensionIds) {
  try {
    return JSON.parse(window.__adobe_cep__.getExtensions(extensionIds));
  } catch(e) {
    return [];
  }
};
