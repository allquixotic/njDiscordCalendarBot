import puppeteer from 'puppeteer';
import Client from 'discord.js';
import Luxon = require("luxon");
import Sugar from 'sugar';
const to = require('await-to-js').default;
//import Attachment from 'discord.js';
//const fs = require('fs');

//Settings
interface Config {
  loginUrl: string;
  calendarUrl: string;
  discordSecret: string;
  discordChannels?: (null)[] | null;
  postRegexp: string;
  updateRegexp: string;
  username: string;
  password: string;
  updateFrequency: number;
}
const config : Config = require('./config.json') || {};
/*
  config.json example:
  {
    "loginUrl": "https://example.enjin.com/login",
    "calendarUrl": "https://example.enjin.com/events",
    "discordSecret": "asdfg",
    "discordChannels": ["general"],
    "postRegexp": "!post",
    "updateRegexp": "!postUpdate",
    "updateFrequency" : 3600,
    "username": "foo@example.com",
    "password": "hackme"
  }
*/

interface MyEvent {
  when: string,
  title: string,
  recurring : boolean
}

//Constant strings
const xpLoginLink = "//a[@href='/login' and .='Login']";
const xpUsername = "//*[@name='username']";
const xpPassword = "//input[@type='password']";
const xpLoginButton = "//input[@type='submit' and @value='Login']";
//const xpToday = "//td[contains(@class, 'fc-today')]";
const xpMonth = "//div[contains(@class, 'calendar-container')]/div[contains(@class, 'block-title')]/div[contains(@class, 'text')]/span[contains(@class, 'mask')]";
const xpDayTd = "//td[contains(@class, 'fc-day')]";
const xpDayNumber = "div[contains(@class, 'fc-day-number')]";
const csEventBoxesImage = ".fc-event-image > .desc";
const csEventBoxes = ".fc-event";
const pageWait : puppeteer.DirectNavigationOptions = {waitUntil: [ 'domcontentloaded', 'load', 'networkidle2' ]};
const xpathOptions = {visible: true, timeout: 5000};
const calendarData : Map<Date, Array<MyEvent>> = new Map<Date, Array<MyEvent>>();
var lastUpdate : Luxon.DateTime = null;

//Puppeteer
var browser : puppeteer.Browser = null; 
var page : puppeteer.Page = null; 

//Discord
const client : Client.Client = new Client.Client();
const dcPostRx = new RegExp(config.postRegexp + '\\s*(\\S*)', "i");
const updateRx = new RegExp(config.updateRegexp + "\\s*(\\S*)", "i");
const classRx  = new RegExp(".*fc-day(\\d+).*")

interface ClientRect {
  left: number;
  right: number;
  top: number;
  bottom: number; 
  x: number;
  y: number;
  width: number;
  height: number;
}
async function getBoundingClientRect(el1 : puppeteer.ElementHandle) : Promise<ClientRect> {
  let boundingBox : puppeteer.BoundingBox = await el1.boundingBox();
  let retval : ClientRect = {
    left : boundingBox.x,
    top : boundingBox.y,
    right : boundingBox.x + boundingBox.width,
    bottom : boundingBox.y + boundingBox.height,
    width : boundingBox.width,
    height : boundingBox.height,
    x : boundingBox.x,
    y : boundingBox.y
  };
  return retval;
}

async function rinside(rect1 : ClientRect, rect2 : ClientRect) : Promise<boolean> {
  return (
    ((rect2.top <= rect1.top) && (rect1.top <= rect2.bottom)) &&
    ((rect2.top <= rect1.bottom) && (rect1.bottom <= rect2.bottom)) &&
    ((rect2.left <= rect1.left) && (rect1.left <= rect2.right)) &&
    ((rect2.left <= rect1.right) && (rect1.right <= rect2.right))
  );
}

async function inside(el1 : puppeteer.ElementHandle, el2: puppeteer.ElementHandle) {
  var rect1 : ClientRect = await getBoundingClientRect(el1);
  var rect2 : ClientRect = await getBoundingClientRect(el2);
  return rinside(rect1, rect2) || rinside(rect2, rect1);
}

function sleep(ms : number) {
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

interface MyDay {
  element : puppeteer.ElementHandle,
  dayOfMonth: number,
  month: number,
  year: number,
  date: Date
};
async function timeToUpdate() {
  console.log("Time to update.");
  let lg = await login();
  if(lg) {
    throw "ERROR: Wasn't able to login!";
  }
  console.log("INFO: Logged into Enjin site; waiting 8 seconds");
  await sleep(8000);

  calendarData.clear();
  let retval = {};
  let [ err, dateElement ] = await to(page.waitForXPath(xpMonth));
  if(dateElement) {
    let mainMonth : Date = Sugar.Date.create(await page.evaluate(element => element.textContent, dateElement));
    const days : Array<MyDay> = [];
    let dayElements : Array<puppeteer.ElementHandle> = await page.$x(xpDayTd);
    for(let dayElement of dayElements) {
      let itsClass = await page.evaluate(element => element.getAttribute("class"), dayElement);
      let dayNum = parseInt(itsClass.match(classRx)[1], 10);
      let dayns : Array<puppeteer.ElementHandle> = await dayElement.$x(xpDayNumber);
      let dom = parseInt(await page.evaluate(element => element.textContent, dayns[0]));
      days[dayNum] = {
        element: dayElement,
        dayOfMonth: dom,
        month: null,
        year: null,
        date : null
      };
    }

    //This loop fills in the month and year for each "cell" in the table.
    let foundCurrentMonthYet : boolean = false;
    let currMonth : sugarjs.Date.Chainable<Date> = new Sugar.Date(mainMonth);
    let prevMonth : sugarjs.Date.Chainable<Date> = new Sugar.Date(mainMonth).addMonths(-1);
    let nextMonth : sugarjs.Date.Chainable<Date> = new Sugar.Date(mainMonth).addMonths(1);
    let currMonthNum = currMonth.getMonth().valueOf();
    let prevMonthNum = prevMonth.getMonth().valueOf();
    let nextMonthNum = nextMonth.getMonth().valueOf();
    let currYearNum = currMonth.getFullYear().valueOf();
    let prevYearNum = prevMonth.getFullYear().valueOf();
    let nextYearNum = nextMonth.getFullYear().valueOf();
    for(let i : number = 0; i < days.length; i++) {
      let eltClass : string = await page.evaluate(element => element.getAttribute("class"), days[i].element);
      let elementIsCurrentMonth : boolean = !eltClass.includes("fc-other-month");
      if(elementIsCurrentMonth) {
        //This is exactly the month listed on the calendar
        foundCurrentMonthYet = true;
        days[i].month = currMonthNum;
        days[i].year  = currYearNum;
      }
      else {
        if(foundCurrentMonthYet) {
          //This is the month AFTER the month listed on the calendar
          days[i].month = nextMonthNum;
          days[i].year  = nextYearNum;
        }
        else {
          //This is the month BEFORE the month listed on the calendar
          days[i].month = prevMonthNum;
          days[i].year  = prevYearNum;
        }
      }
      days[i].date = new Date(days[i].year, days[i].month, days[i].dayOfMonth);
    }

    //Get all the event box elements from the page.
    let [ err3, eventBoxes ] : [ any, Array<puppeteer.ElementHandle> ] = await to(page.$$(csEventBoxes));
    let [ err4, eventBoxesImage ] : [ any, Array<puppeteer.ElementHandle> ] = await to(page.$$(csEventBoxesImage));
    if((eventBoxes == null || eventBoxes.length <= 0 ) && (eventBoxesImage == null || eventBoxesImage.length <= 0)) {
      //TODO: Handle this better and don't fail out of the program completely, just whine to the user
      throw "ERROR: Wasn't able to see ANY events!";
    }

    //Remove birthdays because they fuck everything up badly
    eventBoxes = eventBoxes.filter(async (ebox) => {
      let p : string = await page.evaluate(element => element.getAttribute("class"), ebox);
      return !p.includes("birthday");
    });

    eventBoxesImage = eventBoxesImage.filter(async (ebox) => {
      let p : string = await page.evaluate(element => element.getAttribute("class"), ebox);
      return !p.includes("birthday");
    });

    const processEltsFunc = async function (arr : Array<puppeteer.ElementHandle>, parseFunc : (arg1: puppeteer.ElementHandle) => Promise<MyEvent>) {
      for(let eventBox of arr || []) {
        for(let i : number = 0; i < days.length; i++) {
          if(inside(days[i].element, eventBox)) {
            //We found the cell we belong in!
            let dd : Date = days[i].date;
            //Scrape the values
            let evt : MyEvent = await parseFunc(eventBox);
            if(calendarData.has(dd)) {
              //Put the event into an existing Array
              calendarData.get(dd).push(evt);
            }
            else {
              //Put the event into a new Array
              calendarData.set(dd, [evt]);
            }
            break;
          }
        }
      }
    }

    //Process all the non-image event boxes
    await processEltsFunc(eventBoxes, async function(elt : puppeteer.ElementHandle) : Promise<MyEvent> {
      let time : string = await elt.$eval(".fc-event-time", element => (element as any).innerText);
      return {
        recurring : time.startsWith("R"),
        when : time.replace("R", ""),
        title : await elt.$eval(".fc-event-title", element => (element as any).innerText)
      };
    });

    //Process all the image event boxes
    await processEltsFunc(eventBoxesImage, async function(elt : puppeteer.ElementHandle) : Promise<MyEvent> {
      let descWrapperText : string = await elt.$eval(".desc-wrapper", e => (e as any).innerText);
      return {
        recurring : descWrapperText.startsWith("R"),
        when : descWrapperText.split("\n")[0].replace("R", ""),
        title : descWrapperText.split("\n").slice(1).join(" ")
      };
    });

    //Sort each day's events by date
    for(let [k, v] of calendarData) {
      v.sort(function(a : MyEvent, b : MyEvent) : number {
        return Sugar.Date.create(a.when).getTime() - Sugar.Date.create(b.when).getTime();
      });
    }
  }
  else throw "ERROR: Wasn't able to get the current month!";

  lastUpdate = Luxon.DateTime.local();
}

async function getCalendar(dt : Date) : Promise<string> {
  let evtList = calendarData.get(dt);
  if(evtList) {
    let retval : string = "";
    for(let rv of evtList) {
      let rec : string = rv.recurring ? "(recurring)" : "";
      retval += `"${rv.title}" ${rec} at ${rv.when}`;
    }
    return retval;
  }
  else {
    return `Sorry, ${dt.toLocaleDateString()} is too far in the past/future so I can't get you any data on it right now. Try again another day!`;
  }
}

async function setupDiscord() {
  client.on('error', console.error);
  client.on('ready', () => {
    console.log("INFO: Discord ready.")
  });
  client.on('message', async (msg) => {
    let rxMatchCached = msg.content.match(dcPostRx);
    let rxMatchUpdate = msg.content.match(updateRx);
    let updateRequested = rxMatchUpdate != null;
    let rxMatch = rxMatchCached || rxMatchUpdate;
    if(msg.author.id != client.user.id && rxMatch) {
      let argument = rxMatch ? rxMatch[1].substring(0,80) : null;
      if(argument.length <= 0) {
        argument = Luxon.DateTime.local().toLocaleString();  
      }
      let kron = Sugar.Date.create(argument);
      let dt : Luxon.DateTime = Luxon.DateTime.fromJSDate(kron);
      if(kron) {
        let numSecondsStale = lastUpdate ? Math.trunc(Luxon.DateTime.local().setLocale('en-us').diff(lastUpdate, 'seconds').toObject().seconds) : 99999999;
        if(updateRequested) {
          await msg.channel.send(`${msg.author} Okay, I'm updating my cache of the event calendar. This will take a minute or so. `
          + `I will print the up-to-date calendar for ${dt.setLocale('en-us').toLocaleString()} when I'm done.`);
          await timeToUpdate();
        }
        else {
          if(lastUpdate == null || numSecondsStale > config.updateFrequency) {
            await msg.channel.send(`${msg.author} My cache of the event calendar is ${numSecondsStale} seconds stale; I think that's too long. `
            + `Hang on a minute or so while I update my cache for you.`);
            await timeToUpdate();
          }
        }
        await msg.channel.send(`${msg.author} Here is ${dt.setLocale('en-us').toLocaleString(Luxon.DateTime.DATE_SHORT)}'s calendar.`
        + ` I last refreshed my cache on ${lastUpdate.setLocale('en-us').toLocaleString(Luxon.DateTime.DATETIME_FULL)}; `
        + `if that's too old, run \`${config.updateRegexp}\` to get the latest possible.`);
        msg.channel.send(getCalendar(dt.setLocale('en-us').toJSDate()));
      }
      else {
        msg.channel.send(`${msg.author} I didn't understand ${argument}`);
      }
    }
  });
  client.login(config.discordSecret);
}

async function main() {
  if(!config.updateFrequency) {
    config.updateFrequency = 3600;
  }
  await setupPuppeteer();
  await timeToUpdate();
  await setupDiscord();
}

main();
