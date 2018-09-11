const moment = require("moment"),
  ms = require("ms");

var a = function(mongoose, options) {
  let self = this;

  if (!(typeof options == "object" && !Array.isArray(options)))
    throw new Error("options must be an object");
  if (!options.schema instanceof mongoose.Schema)
    throw new Error("options.schema must be a Mongoose Schema");
  if (
    !options.hasOwnProperty("uniqueKeys") ||
    !Array.isArray(options.uniqueKeys)
  )
    throw new Error("options.uniqueKeys must be set and be an Array");

  options = Object.assign(
    {
      interval: "day",
      modelName: "MTSSchema",
      tsArraySize: 500
    },
    options,
    {
      granularity: ["second", "minute", "hour", "day", "week", "month", "year"],
      formats: {
        minute: "YYYY-MM-DD H:m",
        hour: "YYYY-MM-DD H:00",
        day: "YYYY-MM-DD",
        week: "YYYY-W",
        month: "YYYY-MM",
        year: "YYYY"
      }
    }
  );

  options.interval =
    options.granularity.slice(1).indexOf(options.interval) > -1
      ? options.interval
      : "day";

  //create model if not created already
  // console.log(mongoose.modelSchemas);
  if (mongoose.modelSchemas.hasOwnProperty(options.modelName) === false) {
    mongoose.model(options.modelName, options.schema);
  }

  self = Object.assign(self, options, {
    model: mongoose.model(options.modelName)
  });

  //add plugins
  self.statsPlugin();
};

a.prototype.statsPlugin = function statsPlugin() {
  let self = this;

  var avg = self.granularity
    .map(g => {
      return {
        [g]: {
          val: { type: Number },
          isForecast: Boolean
        }
      };
    })
    .reduce((a, b) => Object.assign(a, b), {});

  self.schema.add({
    mts__stats: {
      count: Number,
      avg: avg,
      t: String,
      ts: [Date]
    },
    mts__interval: {
      duration: {
        type: String,
        index: {
          sparse: true
        }
      },
      t: {
        type: String,
        index: {
          sparse: true
        }
      },
      start: {
        type: Date,
        index: {
          sparse: true
        }
      },
      end: Date
    },
    createdAt: Date,
    updatedAt: Date
  });
};

a.prototype.makeStats = function makeStats(stats) {
  let self = this;

  var ts = ((stats && stats.ts) || [])
    .concat([new Date()])
    .slice(-1 * self.tsArraySize);

  // calculate hits per hour & so on
  var index = self.granularity.indexOf(self.interval),
    avg = {},
    granulars = self.granularity.slice(0, index + 1);

  granulars.forEach(g => {
    var diff = moment(ts[ts.length - 1]).diff(
        moment(ts[0]),
        `${g}s`,
        true
      ),
      val = Math.ceil(ts.length / diff);

    avg[g] = {
      val: isFinite(val) ? val : 0,
      isForecast: diff < 1
    };
  });

  return {
    ts,
    mts__stats: {
      avg
    }
  };
};



a.prototype.save = function saveStat(doc) {
  let self = this;

  return new Promise(async (resolve, reject) => {

    var status = null,
      now = new Date(),
      query = Object.assign(pick(doc, self.uniqueKeys), {
        "mts__interval.duration": self.interval,
        "mts__interval.start": { $lt: now },
        "mts__interval.end": { $gt: now }
      });

    // console.log(query);

    var q = self.model.where(query),
      found = await q
        .findOne(query)
        .lean()
        .exec();

    // console.log(found);

    if (found) {
      var { ts, mts__stats } = self.makeStats(found.mts__stats);

      //   console.log(ts);
      var setData = dotify({ mts__stats });
      setData["mts__stats.ts"] = ts;
      setData.updatedAt = new Date();

      // console.log(setData);

      try {
        status = await q
          .update({
            $set: setData,
            $inc: {
              "mts__stats.count": 1
            }
          })
          .exec();
      } catch (error) {
        return reject(error);
      }
    } else {
      doc.mts__interval = {
        t: moment().format(self.formats[self.interval]),
        duration: self.interval,
        start: new Date(),
        end: moment()
          .add(1, self.interval)
          .toDate()
      };

      doc["mts__stats.ts"] = [new Date()];

      doc.createdAt = new Date();

      try {
        await self.model.create(doc);
        status = { n: 1, nCreated: 1, ok: 1 };
      } catch (error) {
        return reject(error);
      }
    }

    resolve(status);
  });
};

a.prototype.expore = function(start, end, uniqueKeys) {
  let self = this;
  return new Promise(async (resolve, reject) => {
    if (!start instanceof Date) throw new Error("'start' must be a Date");
    if (!end instanceof Date) throw new Error("'end' must be a Date");
    if (uniqueKeys && !Array.isArray(uniqueKeys))
      throw new Error("'uniqueKeys' must be an array");

    var query = Object.assign(uniqueKeys || {}, {
      "mts__interval.duration": self.interval,
      "mts__interval.start": { $gte: start },
      "mts__interval.end": { $lte: end }
    });

    // console.log(query);

    var index = self.granularity.indexOf(self.interval),
      granulars = self.granularity.slice(0, index + 1);

    avgs = granulars
      .map(g => {
        return {
          [`avg/${g}`]: { $avg: `$mts__stats.avg.${g}.val` },
          [`forecast/${g}`]: { $addToSet: `$mts__stats.avg.${g}.isForecast` }
        };
      })
      .reduce((a, b) => Object.assign(a, b), {});

    // console.log(avgs);

    var aggs = await self.model
      .aggregate()
      .match(query)
      .sort("mts__interval.t")
      .group(
        Object.assign(
          {
            _id: null,
            // count: { $sum: 1 },
            avg_minute: { $avg: "$mts__stats.avg.minute.val" },

            timeSeries: {
              $push: { t: "$mts__interval.t", val: "$mts__stats.count" }
            },

            start: { $min: "$mts__interval.start" },
            end: { $max: "$mts__interval.end" }
          },
          avgs
        )
      )
      .project("-_id")
      .exec()
      .catch(console.error);

    if (!aggs || aggs.length === 0) {
      return resolve(null);
    }

    var stats = {
      overview: {
        count: 0,
        avg: {}
      },
      timeSeries: aggs[0].timeSeries.filter(a => Object.keys(a).length == 2),
      meta: {
        start: aggs[0].start,
        end: aggs[0].end
      }
    };

    stats.meta.duration = {
      ms: moment(stats.meta.end).diff(moment(stats.meta.start))
    };
    stats.meta.duration.formated = ms(stats.meta.duration.ms, { long: true });

    granulars.forEach(g => {
      stats.overview.avg[g] = {
        val: Number(aggs[0][`avg/${g}`].toFixed(3)),
        hasForecast: aggs[0][`forecast/${g}`].indexOf(true) > -1
      };
    });

    stats.overview.count = stats.timeSeries.length;

    resolve(stats);
  });
};


function pick(obj, arr) {
  return arr
    .map(k => {
      return { [k]: obj[k] || null };
    })
    .filter(o => Object.values(o)[0])
    .reduce((a, b) => Object.assign(a, b), {});
}

//stolen from https://github.com/GeenenTijd/dotify/blob/master/dotify.js
function dotify(obj) {
  var res = {};
  function recurse(obj, current) {
    for (var key in obj) {
      var value = obj[key];
      var newKey = (current ? current + '.' + key : key);  // joined key with dot
      if (value && typeof value === 'object') {
        recurse(value, newKey);  // it's a nested object, so do it again
      } else {
        res[newKey] = value;  // it's not an object, so set the property
      }
    }
  }

  recurse(obj);
  return res;
}


module.exports = function(mongoose, options) {
  return new a(mongoose, options);
};
