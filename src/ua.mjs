const BOT_UA =
  /(?:bot|crawler|spider|headless|phantomjs|puppeteer|playwright|selenium|webdriver|curl\/|wget\/|python-requests|python-urllib|go-http-client|libwww|scrapy|httpclient|okhttp|java\/|axios\/|node-fetch|undici|postman|insomnia|httpie)/i;

export function isAutomationUa(ua) {
  if (typeof ua !== "string") return true;
  const trimmed = ua.trim();
  if (trimmed.length < 8) return true;
  return BOT_UA.test(trimmed);
}
