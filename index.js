const puppeteer = require('puppeteer');
const to = require('await-to-js').default;
const { Client, Attachment } = require('discord.js');
const fs = require('fs');

//Settings
const config = require('./config.json') || {};
/*
  config.json example:
  {
    "loginUrl": "https://example.enjin.com/login",
    "calendarUrl": "https://example.enjin.com/events",
    "discordSecret": "asdfg",
    "discordChannels": ["general"],
    "postRegexp": "!post"
  }
*/

//Constant strings
const xpLoginLink = "//a[@href='/login' and .='Login']";
const xpUsername = "//*[@name='username']";
const xpPassword = "//input[@type='password']";
const xpLoginButton = "//input[@type='submit' and @value='Login']";
const xpToday = "//td[contains(@class, 'fc-today')]";
const pageWait = {waitUntil: [ 'domcontentloaded', 'load', 'networkidle2' ]};
const xpathOptions = {visible: true, timeout: 5000};

//Puppeteer
var browser = null; 
var page = null; 

//Discord
const client = new Client();
const dcPostRx = new RegExp(config.postRegexp, "i");

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function setupPuppeteer() {
  if(!browser) browser = await puppeteer.launch();
  if(!page) {
    page = await browser.newPage();
    page.setViewport({width: 1920, height: 1080, deviceScaleFactor: 2});
  }
}

async function login() {
  await page.goto(config.calendarUrl, pageWait);
  let [ err, element ] = await to(page.waitForXPath(xpLoginLink, xpathOptions));
  if(element) {
    console.log("INFO: Need to log in.");
    await page.goto(config.loginUrl, pageWait);
    let e = await page.waitForXPath(xpUsername, xpathOptions);
    await e.type(config.username);
    e = await page.waitForXPath(xpPassword, xpathOptions);
    await e.type(config.password);
    e = await page.waitForXPath(xpLoginButton, xpathOptions);
    await e.click();
    console.log("INFO: Clicked login; waiting now.");
    await sleep(10000);
    [ err, element ] = await to(page.waitForXPath(xpLoginLink, xpathOptions));
    await page.goto(config.calendarUrl, pageWait);
  }
  else {
    await page.reload();
  }
  return element;
}

async function takeScreenshot() {
  let lg = await login();
  if(lg) {
    throw "ERROR: Wasn't able to login!";
  }
  console.log("INFO: Logged into Enjin site; waiting 8 seconds");
  await sleep(8000);
  let [ err, element ] = await to(page.waitForXPath(xpToday, {timeout: 30000, visible: true}));
  if(element) {
    console.log("INFO: Taking screenshot");
    let ss = await element.screenshot({encoding: 'binary', type: 'png'});
    fs.writeFileSync('debug.png', ss);
    return ss;
  }
  else {
    console.log("WARN: Didn't find today on the calendar!");
    return null;
  }
}

async function setupDiscord() {
  client.on('error', console.error);
  client.on('ready', () => {
    console.log("INFO: Discord ready.")
  });
  client.on('message', async (msg) => {
    if(msg.author.id != client.user.id && msg.content.match(dcPostRx)) {
      let ss = await takeScreenshot();
      if(ss == null) {
        throw "ERROR: Couldn't get the screenshot.";
      }
      let attachment = new Attachment(ss, 'events-today.png');
      msg.channel.send(`${msg.author} Here is today's calendar:`, attachment);
    }
  });
  client.login(config.discordSecret);
}

async function main() {
  await setupPuppeteer();
  await setupDiscord();
}

main();
