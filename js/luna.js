/*
 * Mini puente a los servicios Luna de webOS sin depender de webOSTV.js.
 * En un navegador de escritorio (sin PalmServiceBridge) todas las llamadas
 * fallan de forma controlada para poder previsualizar la interfaz.
 */
(function (global) {
  'use strict';

  var bridges = [];

  function call(uri, params, onSuccess, onFailure) {
    if (typeof global.PalmServiceBridge === 'undefined') {
      if (onFailure) {
        setTimeout(function () {
          onFailure({ returnValue: false, errorText: 'PalmServiceBridge no disponible' });
        }, 0);
      }
      return;
    }

    var bridge = new global.PalmServiceBridge();
    bridges.push(bridge); // evita que el GC lo recoja antes de la respuesta

    bridge.onservicecallback = function (raw) {
      var idx = bridges.indexOf(bridge);
      if (idx !== -1) bridges.splice(idx, 1);

      var res;
      try { res = JSON.parse(raw); } catch (e) { res = { returnValue: false, errorText: String(e) }; }

      if (res.returnValue === false || res.errorCode) {
        if (onFailure) onFailure(res);
      } else if (onSuccess) {
        onSuccess(res);
      }
    };

    bridge.call(uri, JSON.stringify(params || {}));
  }

  function launch(appId, onFailure) {
    call('luna://com.webos.applicationManager/launch', { id: appId }, null, onFailure);
  }

  function listLaunchPoints(onSuccess, onFailure) {
    call('luna://com.webos.applicationManager/listLaunchPoints', {}, function (res) {
      onSuccess(res.launchPoints || []);
    }, onFailure);
  }

  function platformBack() {
    if (global.PalmSystem && global.PalmSystem.platformBack) {
      global.PalmSystem.platformBack();
    } else {
      global.close();
    }
  }

  global.Luna = {
    call: call,
    launch: launch,
    listLaunchPoints: listLaunchPoints,
    platformBack: platformBack
  };
})(window);
