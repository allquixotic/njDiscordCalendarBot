import puppeteer from 'puppeteer';
import Client from 'discord.js';
import Luxon = require("luxon");
import Sugar from 'sugar';
import Bluebird from "bluebird";
const to = require('await-to-js').default;

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
  minCacheAge: number;
  proxy?: string;
  proxyUser?: string;
  proxyPass?: string;
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
const calendarData : Map<number, Array<MyEvent>> = new Map<number, Array<MyEvent>>();
var lastUpdate : Luxon.DateTime = null;
var isUpdating : boolean = false;

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

function rinside(rect1 : ClientRect, rect2 : ClientRect) : boolean {
  return (
    ((rect2.top <= rect1.top) && (rect1.top <= rect2.bottom)) &&
    ((rect2.top <= rect1.bottom) && (rect1.bottom <= rect2.bottom)) &&
    ((rect2.left <= rect1.left) && (rect1.left <= rect2.right)) &&
    ((rect2.left <= rect1.right) && (rect1.right <= rect2.right))
  );
}

async function inside(el1 : puppeteer.ElementHandle, el2: puppeteer.ElementHandle) : Promise<boolean> {
  var rect1 : ClientRect = await getBoundingClientRect(el1);
  var rect2 : ClientRect = await getBoundingClientRect(el2);
  let r1 : boolean = rinside(rect1, rect2);
  let r2 : boolean = rinside(rect2, rect1);
  //console.log(`inside: r1=${r1}, r2=${r2}`);
  return r1 || r2;
}

function sleep(ms : number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function setupPuppeteer() {
  if(!browser) {
    if(config.proxy) {
      console.log("Using a proxy.");
      browser = await puppeteer.launch({ args: [`--proxy-server=${config.proxy}`] });
    }
    else {
      console.log("NOT using a proxy.");
      browser = await puppeteer.launch();
    }
  }
  if(!page) {
    page = await browser.newPage();
    if(config.proxyUser && config.proxyPass) {
      console.log("Using proxy authentication.");
      await page.authenticate({
        username: config.proxyUser,
        password: config.proxyPass,
      });
    }
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
  if(isUpdating) {
    while(isUpdating) {
      await sleep(1000);
    }
    return;
  }
  isUpdating = true;
  console.log("Time to update.");
  let lg = await login();
  if(lg) {
    throw "ERROR: Wasn't able to login!";
  }
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  await page.reload();
  console.log("INFO: Logged into Enjin site; waiting 8 seconds");
  await sleep(8000);
  console.log("INFO: On " + page.url());

  calendarData.clear();
  let retval = {};
  let [ err, dateElement ] = await to(page.waitForXPath(xpMonth));
  if(dateElement) {
    let mainMonth : Date = Sugar.Date.create(await page.evaluate(element => element.textContent, dateElement));
    const days : Array<MyDay> = [];
    let dayElements : Array<puppeteer.ElementHandle> = await page.$x(xpDayTd);
    for(let dayElement of dayElements) {
      let itsClass = await page.evaluate(element => element.getAttribute("class"), dayElement);
      let dayNum = parseInt(itsClass.match(classRx)[1]);
      let dayns : Array<puppeteer.ElementHandle> = await dayElement.$x(xpDayNumber);
      let daynstr : string = await page.evaluate(element => element.textContent, dayns[0]);
      let dom : number = parseInt(daynstr);
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
    const currMonthNum : number = Luxon.DateTime.fromJSDate(mainMonth).month;
    const prevMonthNum : number = Luxon.DateTime.fromJSDate(mainMonth).plus(Luxon.Duration.fromObject({months: -1})).month;
    const nextMonthNum : number = Luxon.DateTime.fromJSDate(mainMonth).plus(Luxon.Duration.fromObject({months: 1})).month;
    const currYearNum : number = Luxon.DateTime.fromJSDate(mainMonth).year;
    const prevYearNum : number = Luxon.DateTime.fromJSDate(mainMonth).plus(Luxon.Duration.fromObject({months: -1})).year;
    const nextYearNum : number = Luxon.DateTime.fromJSDate(mainMonth).plus(Luxon.Duration.fromObject({months: 1})).year;
    //console.log(`Calendar nums: ${currMonthNum}, ${prevMonthNum}, ${nextMonthNum}, ${currYearNum}, ${prevYearNum}, ${nextYearNum}`);
    for(let day of days) {
      let eltClass : string = await page.evaluate(element => element.getAttribute("class"), day.element);
      let elementIsCurrentMonth : boolean = !eltClass.includes("fc-other-month");
      if(elementIsCurrentMonth) {
        //This is exactly the month listed on the calendar
        foundCurrentMonthYet = true;
        day.month = currMonthNum;
        day.year  = currYearNum;
      }
      else {
        if(foundCurrentMonthYet) {
          //This is the month AFTER the month listed on the calendar
          day.month = nextMonthNum;
          day.year  = nextYearNum;
        }
        else {
          //This is the month BEFORE the month listed on the calendar
          day.month = prevMonthNum;
          day.year  = prevYearNum;
        }
      }
      day.date = new Date(day.year, day.month - 1, day.dayOfMonth);
      //console.log(`Day Detected: ${day.date.toLocaleDateString()}`);
    }

    //Get all the event box elements from the page.
    let [ err3, eventBoxes ] : [ any, Array<puppeteer.ElementHandle> ] = await to(page.$$(csEventBoxes));
    let [ err4, eventBoxesImage ] : [ any, Array<puppeteer.ElementHandle> ] = await to(page.$$(csEventBoxesImage));
    while((eventBoxes == null || eventBoxes.length <= 0 ) && (eventBoxesImage == null || eventBoxesImage.length <= 0)) {
      //TODO: Handle this better and don't fail out of the program completely, just whine to the user
      throw "ERROR: Wasn't able to see ANY events!";
      /*await page.screenshot({path: 'badcal.png'});
      console.log("Waiting more time for events to show up.");
      await sleep(5000);
      [ err3, eventBoxes ] = await to(page.$$(csEventBoxes));
      [ err4, eventBoxesImage ] = await to(page.$$(csEventBoxesImage));
      */
    }

    //Remove birthdays because they fuck everything up badly
    const filterFunc : (ebox : puppeteer.ElementHandle) => Promise<boolean> = async function(ebox : puppeteer.ElementHandle) : Promise<boolean> {
      let p : string = await page.evaluate(element => element.getAttribute("class"), ebox);
      let ih : string = await page.evaluate(element => element.innerHTML, ebox);
      return !p.toLowerCase().includes("birthday") && !ih.toLowerCase().includes("birthday");
    };
    eventBoxes = await Bluebird.filter(eventBoxes, filterFunc);
    eventBoxesImage = await Bluebird.filter(eventBoxesImage, filterFunc);

    const processEltsFunc = async function (arr : Array<puppeteer.ElementHandle>, parseFunc : (arg1: puppeteer.ElementHandle) => Promise<MyEvent>) {
      for(let eventBox of arr || []) {
        let foundDay : boolean = false;
        for(let day of days) {
          let bInside : boolean = await inside(day.element, eventBox);
          if(bInside) {
            //We found the cell we belong in!
            foundDay = true;
            let dd : Date = day.date;
            //Scrape the values
            let evt : MyEvent = await parseFunc(eventBox);
            if(evt.when && evt.when.length > 0) {
              if(calendarData.has(dd.getTime())) {
                //Put the event into an existing Array
                calendarData.get(dd.getTime()).push(evt);
              }
              else {
                //Put the event into a new Array
                calendarData.set(dd.getTime(), [evt]);
              }
            }
            else {
              console.log("Found an event box without a time! " + JSON.stringify(evt));
            }
            break;
          }
        }
        if(!foundDay) {
          console.log("Uh oh!");
          let evt : MyEvent = await parseFunc(eventBox);
          console.log(`Not sure where ${myEventToString(evt)} belongs; didn't find a day for it. Rect: ${JSON.stringify(await getBoundingClientRect(eventBox))}`);
        }
      }
    };

    //Process all the non-image event boxes
    await processEltsFunc(eventBoxes, async function(elt : puppeteer.ElementHandle) : Promise<MyEvent> {
      let time : string = "";
      try {
        let times : Array<puppeteer.ElementHandle> = await elt.$x("//span[contains(@class,'fc-event-time')]");
        time = await page.evaluate(t => t.textContent, times[0]);
      }
      catch{}
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

  // try {
  //   for(let [k, v] of calendarData) {
  //     console.log(`${new Date(k).toLocaleDateString()}: `);
  //     for(let j of v) {
  //       console.log(`    ${myEventToString(j)}`);
  //     }
  //     console.log("--------");
  //   }
  // }
  // catch {

  // }

  lastUpdate = Luxon.DateTime.local();
  isUpdating = false;
}

function myEventToString(rv : MyEvent) : string {
  let rec : string = rv.recurring ? "(recurring)" : "";
  return `"${rv.title}" ${rec} at ${rv.when}`;
}

function getCalendar(parm : number) : string {
  let dt : Date = new Date(parm);
  let evtList = calendarData.get(parm) || [];
  //console.log(`getCalendar called for ${dt.toLocaleDateString()} and we got an event list of ${evtList.length} elements`);
  if(evtList && evtList.length > 0) {
    let retval : string = "";
    let first : boolean = true;
    for(let rv of evtList) {
      if(!first) {
        retval += "\n";
      }
      retval += myEventToString(rv);
      first = false;
    }
    return retval;
  }
  else {
    return `Sorry, ${dt.toLocaleDateString()} is too far in the past/future so I can't get you any data on it. I only know about events that display on the current month view of the calendar on the website.`;
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
          if(numSecondsStale < config.minCacheAge) {
            await msg.channel.send(`${msg.author} Whoa, easy there partner! I just updated the cache ${numSecondsStale} seconds ago; if you want an even fresher calendar, wait at least ${config.minCacheAge - numSecondsStale} seconds and try again.`);
          }
          else {
            await msg.channel.send(`${msg.author} Okay, I'm updating my cache of the event calendar. This will take a minute or so. `
            + `I will print the up-to-date calendar for ${dt.setLocale('en-us').toLocaleString()} when I'm done.`);
            await timeToUpdate();
          }
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
        let calendarStr : string = getCalendar(dt.setLocale('en-us').toJSDate().getTime());
        if(calendarStr == null || calendarStr == undefined || calendarStr.length == 0) {
          calendarStr = "Er, uh... so I actually lied; I don't have any calendar data for this date. I have no idea why; maybe there just aren't any events on that day. If that sounds unlikely, this is probably a coding error. Ping my owner. Sorry!";
        }
        await msg.channel.send(calendarStr);
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
  if(!config.minCacheAge) {
    config.minCacheAge = 300;
  }
  await setupPuppeteer();
  await timeToUpdate();
  await setupDiscord();
}

main();
