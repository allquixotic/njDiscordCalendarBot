"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const puppeteer_1 = __importDefault(require("puppeteer"));
const discord_js_1 = __importDefault(require("discord.js"));
const Luxon = require("luxon");
const sugar_1 = __importDefault(require("sugar"));
const to = require('await-to-js').default;
const config = require('./config.json') || {};
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
const pageWait = { waitUntil: ['domcontentloaded', 'load', 'networkidle2'] };
const xpathOptions = { visible: true, timeout: 5000 };
const calendarData = new Map();
var lastUpdate = null;
//Puppeteer
var browser = null;
var page = null;
//Discord
const client = new discord_js_1.default.Client();
const dcPostRx = new RegExp(config.postRegexp + '\\s*(\\S*)', "i");
const updateRx = new RegExp(config.updateRegexp + "\\s*(\\S*)", "i");
const classRx = new RegExp(".*fc-day(\\d+).*");
function getBoundingClientRect(el1) {
    return __awaiter(this, void 0, void 0, function* () {
        let boundingBox = yield el1.boundingBox();
        let retval = {
            left: boundingBox.x,
            top: boundingBox.y,
            right: boundingBox.x + boundingBox.width,
            bottom: boundingBox.y + boundingBox.height,
            width: boundingBox.width,
            height: boundingBox.height,
            x: boundingBox.x,
            y: boundingBox.y
        };
        return retval;
    });
}
function rinside(rect1, rect2) {
    return __awaiter(this, void 0, void 0, function* () {
        return (((rect2.top <= rect1.top) && (rect1.top <= rect2.bottom)) &&
            ((rect2.top <= rect1.bottom) && (rect1.bottom <= rect2.bottom)) &&
            ((rect2.left <= rect1.left) && (rect1.left <= rect2.right)) &&
            ((rect2.left <= rect1.right) && (rect1.right <= rect2.right)));
    });
}
function inside(el1, el2) {
    return __awaiter(this, void 0, void 0, function* () {
        var rect1 = yield getBoundingClientRect(el1);
        var rect2 = yield getBoundingClientRect(el2);
        return rinside(rect1, rect2) || rinside(rect2, rect1);
    });
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
function setupPuppeteer() {
    return __awaiter(this, void 0, void 0, function* () {
        if (!browser)
            browser = yield puppeteer_1.default.launch();
        if (!page) {
            page = yield browser.newPage();
            page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 2 });
        }
    });
}
function login() {
    return __awaiter(this, void 0, void 0, function* () {
        yield page.goto(config.calendarUrl, pageWait);
        let [err, element] = yield to(page.waitForXPath(xpLoginLink, xpathOptions));
        if (element) {
            console.log("INFO: Need to log in.");
            yield page.goto(config.loginUrl, pageWait);
            let e = yield page.waitForXPath(xpUsername, xpathOptions);
            yield e.type(config.username);
            e = yield page.waitForXPath(xpPassword, xpathOptions);
            yield e.type(config.password);
            e = yield page.waitForXPath(xpLoginButton, xpathOptions);
            yield e.click();
            console.log("INFO: Clicked login; waiting now.");
            yield sleep(10000);
            [err, element] = yield to(page.waitForXPath(xpLoginLink, xpathOptions));
            yield page.goto(config.calendarUrl, pageWait);
        }
        else {
            yield page.reload();
        }
        return element;
    });
}
;
function timeToUpdate() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log("Time to update.");
        let lg = yield login();
        if (lg) {
            throw "ERROR: Wasn't able to login!";
        }
        console.log("INFO: Logged into Enjin site; waiting 8 seconds");
        yield sleep(8000);
        calendarData.clear();
        let retval = {};
        let [err, dateElement] = yield to(page.waitForXPath(xpMonth));
        if (dateElement) {
            let mainMonth = sugar_1.default.Date.create(yield page.evaluate(element => element.textContent, dateElement));
            const days = [];
            let [err2, dayElements] = yield to(page.$x(xpDayTd));
            for (let dayElement of dayElements) {
                let itsClass = yield page.evaluate(element => element.class, dayElement);
                let dayNum = parseInt(itsClass.match(classRx)[1], 10);
                let dom = parseInt(yield page.evaluate(element => element.textcontent, yield dayElement.$x(xpDayNumber)));
                days[dayNum] = {
                    element: dayElement,
                    dayOfMonth: dom,
                    month: null,
                    year: null,
                    date: null
                };
            }
            //This loop fills in the month and year for each "cell" in the table.
            let foundCurrentMonthYet = false;
            let currMonth = new sugar_1.default.Date(mainMonth);
            let prevMonth = new sugar_1.default.Date(mainMonth).addMonths(-1);
            let nextMonth = new sugar_1.default.Date(mainMonth).addMonths(1);
            let currMonthNum = currMonth.getMonth().valueOf();
            let prevMonthNum = prevMonth.getMonth().valueOf();
            let nextMonthNum = nextMonth.getMonth().valueOf();
            let currYearNum = currMonth.getFullYear().valueOf();
            let prevYearNum = prevMonth.getFullYear().valueOf();
            let nextYearNum = nextMonth.getFullYear().valueOf();
            for (let i = 0; i < days.length; i++) {
                let eltClass = yield page.evaluate(element => element.class, days[i].element);
                let elementIsCurrentMonth = !eltClass.includes("fc-other-month");
                if (elementIsCurrentMonth) {
                    //This is exactly the month listed on the calendar
                    foundCurrentMonthYet = true;
                    days[i].month = currMonthNum;
                    days[i].year = currYearNum;
                }
                else {
                    if (foundCurrentMonthYet) {
                        //This is the month AFTER the month listed on the calendar
                        days[i].month = nextMonthNum;
                        days[i].year = nextYearNum;
                    }
                    else {
                        //This is the month BEFORE the month listed on the calendar
                        days[i].month = prevMonthNum;
                        days[i].year = prevYearNum;
                    }
                }
                days[i].date = new Date(days[i].year, days[i].month, days[i].dayOfMonth);
            }
            //Get all the event box elements from the page.
            let [err3, eventBoxes] = yield to(page.$$(csEventBoxes));
            let [err4, eventBoxesImage] = yield to(page.$$(csEventBoxesImage));
            if ((eventBoxes == null || eventBoxes.length <= 0) && (eventBoxesImage == null || eventBoxesImage.length <= 0)) {
                //TODO: Handle this better and don't fail out of the program completely, just whine to the user
                throw "ERROR: Wasn't able to see ANY events!";
            }
            const processEltsFunc = function (arr, parseFunc) {
                return __awaiter(this, void 0, void 0, function* () {
                    for (let eventBox of arr || []) {
                        for (let i = 0; i < days.length; i++) {
                            if (inside(days[i].element, eventBox)) {
                                //We found the cell we belong in!
                                let dd = days[i].date;
                                //Scrape the values
                                let evt = yield parseFunc(eventBox);
                                if (calendarData.has(dd)) {
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
                });
            };
            //Process all the non-image event boxes
            yield processEltsFunc(eventBoxes, function (elt) {
                return __awaiter(this, void 0, void 0, function* () {
                    let time = yield elt.$eval(".fc-event-time", element => element.innerText);
                    return {
                        recurring: time.startsWith("R"),
                        when: time.replace("R", ""),
                        title: yield elt.$eval(".fc-event-title", element => element.innerText)
                    };
                });
            });
            //Process all the image event boxes
            yield processEltsFunc(eventBoxesImage, function (elt) {
                return __awaiter(this, void 0, void 0, function* () {
                    let descWrapperText = yield elt.$eval(".desc-wrapper", e => e.innerText);
                    return {
                        recurring: descWrapperText.startsWith("R"),
                        when: descWrapperText.split("\n")[0].replace("R", ""),
                        title: descWrapperText.split("\n").slice(1).join(" ")
                    };
                });
            });
            //Sort each day's events by date
            for (let [k, v] of calendarData) {
                v.sort(function (a, b) {
                    return sugar_1.default.Date.create(a.when).getTime() - sugar_1.default.Date.create(b.when).getTime();
                });
            }
        }
        else
            throw "ERROR: Wasn't able to get the current month!";
        lastUpdate = Luxon.DateTime.local();
    });
}
function getCalendar(dt) {
    return __awaiter(this, void 0, void 0, function* () {
        let evtList = calendarData.get(dt);
        if (evtList) {
            let retval = "";
            for (let rv of evtList) {
                let rec = rv.recurring ? "(recurring)" : "";
                retval += `"${rv.title}" ${rec} at ${rv.when}`;
            }
            return retval;
        }
        else {
            return `Sorry, ${dt.toLocaleDateString()} is too far in the past/future so I can't get you any data on it right now. Try again another day!`;
        }
    });
}
function setupDiscord() {
    return __awaiter(this, void 0, void 0, function* () {
        client.on('error', console.error);
        client.on('ready', () => {
            console.log("INFO: Discord ready.");
        });
        client.on('message', (msg) => __awaiter(this, void 0, void 0, function* () {
            let rxMatchCached = msg.content.match(dcPostRx);
            let rxMatchUpdate = msg.content.match(updateRx);
            let updateRequested = rxMatchUpdate != null;
            let rxMatch = rxMatchCached || rxMatchUpdate;
            if (msg.author.id != client.user.id && rxMatch) {
                let argument = rxMatch ? rxMatch[1].substring(0, 80) : null;
                if (argument.length <= 0) {
                    argument = Luxon.DateTime.local().toLocaleString();
                }
                let kron = sugar_1.default.Date.create(argument);
                let dt = Luxon.DateTime.fromJSDate(kron);
                if (kron) {
                    let numSecondsStale = lastUpdate ? Math.trunc(Luxon.DateTime.local().setLocale('en-us').diff(lastUpdate, 'seconds').toObject().seconds) : 99999999;
                    if (updateRequested) {
                        yield msg.channel.send(`${msg.author} Okay, I'm updating my cache of the event calendar. This will take a minute or so. `
                            + `I will print the up-to-date calendar for ${dt.setLocale('en-us').toLocaleString()} when I'm done.`);
                        yield timeToUpdate();
                    }
                    else {
                        if (lastUpdate == null || numSecondsStale > config.updateFrequency) {
                            yield msg.channel.send(`${msg.author} My cache of the event calendar is ${numSecondsStale} seconds stale; I think that's too long. `
                                + `Hang on a minute or so while I update my cache for you.`);
                            yield timeToUpdate();
                        }
                    }
                    yield msg.channel.send(`${msg.author} Here is ${dt.setLocale('en-us').toLocaleString(Luxon.DateTime.DATE_SHORT)}'s calendar.`
                        + ` I last refreshed my cache on ${lastUpdate.setLocale('en-us').toLocaleString(Luxon.DateTime.DATETIME_FULL)}; `
                        + `if that's too old, run \`${config.updateRegexp}\` to get the latest possible.`);
                    msg.channel.send(getCalendar(dt.setLocale('en-us').toJSDate()));
                }
                else {
                    msg.channel.send(`${msg.author} I didn't understand ${argument}`);
                }
            }
        }));
        client.login(config.discordSecret);
    });
}
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        if (!config.updateFrequency) {
            config.updateFrequency = 3600;
        }
        yield setupPuppeteer();
        yield timeToUpdate();
        yield setupDiscord();
    });
}
main();
//# sourceMappingURL=index.js.map