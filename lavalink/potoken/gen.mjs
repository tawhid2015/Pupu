import { Innertube } from "youtubei.js";
import { BG } from "bgutils-js";
import { JSDOM } from "jsdom";

const requestKey = "O43z0dpjhgX20SCx4KAo";

const yt = await Innertube.create({ retrieve_player: false });
const visitorData = yt.session.context.client.visitorData;

const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
  url: "https://www.youtube.com/",
});
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  location: dom.window.location,
  origin: dom.window.origin,
});

const bgConfig = {
  fetch: (url, options) => fetch(url, options),
  globalObj: globalThis,
  identifier: visitorData,
  requestKey,
};

const challenge = await BG.Challenge.create(bgConfig);
if (!challenge) throw new Error("Could not get challenge");

const interpreterJavascript =
  challenge.interpreterJavascript.privateDoNotAccessOrElseSafeScriptWrappedValue;
if (interpreterJavascript) new Function(interpreterJavascript)();
else throw new Error("Could not load VM");

const poTokenResult = await BG.PoToken.generate({
  program: challenge.program,
  globalName: challenge.globalName,
  bgConfig,
});

console.log(JSON.stringify({ poToken: poTokenResult.poToken, visitorData }));
