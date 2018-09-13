const moment = require("moment"),
  ss = require("summary-statistics"),
  ms = require("ms");

var a = function(mongoose, options) {
  let self = this;

  if (!(typeof options == "object" && !Array.isArray(options))) {
    throw new Error("options must be an object");
  }

  if (!options.schema instanceof mongoose.Schema) {
    throw new Error("options.schema must be a Mongoose Schema");
  }

  if (!options.hasOwnProperty("keyBy") || !Array.isArray(options.keyBy)) {
    throw new Error("options.keyBy must be set and be an Array");
  }

  if (!(typeof options == "object" && !Array.isArray(options))) {
    throw new Error("options must be an object");
  }

  if (
    options.calculations &&
    !(
      typeof options.calculations == "object" &&
      !Array.isArray(options.calculations)
    )
  ) {
    throw new Error("options.calculations must be an object");
  }

  if (
    options.unique &&
    !(typeof options.unique == "object" && !Array.isArray(options.unique))
  ) {
    throw new Error("options.calculations must be an object");
  }

  options = Object.assign(
    {
      interval: "day",
      modelName: "MTSSchema",
      tsArraySize: 500,
      calculations: {},
      uniques: {}
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

  var calcs = {},
    uniques = {};

  for (var i in self.calculations) {
    calcs[self.calculations[i]] = [Number];
  }

  for (var i in self.unique) {
    uniques[self.unique[i] + ".count"] = { type: Number, default: 0 };
    uniques[self.unique[i] + ".arr"] = [String];
  }

  // console.log(uniques);

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

    mts__calculations: calcs,
    mts__uniques: uniques,
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
    var diff = moment(ts[ts.length - 1]).diff(moment(ts[0]), `${g}s`, true),
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
      query = Object.assign(pick(doc, self.keyBy), {
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

      // console.log(found);
      var setData = dotify({ mts__stats });
      setData["mts__stats.ts"] = ts;
      setData.updatedAt = new Date();

      var calcs = {},
        uniques = {
          arr: {},
          count: {}
        },
        dotDoc = dotify(doc);
      // console.log(dotDoc);

      for (var i in self.calculations) {
        calcs[`mts__calculations.${self.calculations[i]}`] = dotDoc[i];
      }
      for (var i in self.unique) {
        uniques.arr[`mts__uniques.${self.unique[i]}.arr`] = String(dotDoc[i]);
        uniques.count[`mts__uniques.${self.unique[i]}.count`] = 1;
      }

      var updateObj = {
        $set: setData,
        $inc: Object.assign(
          {
            "mts__stats.count": 1
          },
          uniques.count
        )
        // $push : Object.assign(calcs),
        // $addToSet: Object.assign( uniques.arr)
      };

      if (Object.keys(calcs).length > 0) {
        updateObj["$push"] = Object.assign(calcs);
      }
      if (Object.keys(uniques.arr).length > 0) {
        updateObj["$addToSet"] = Object.assign(uniques.arr);
      }

      // console.log(updateObj)

      try {
        status = await q.update(updateObj).exec();
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

a.prototype.explore = function(start, end, keyBy) {
  let self = this;
  return new Promise(async (resolve, reject) => {
    if (!start instanceof Date) throw new Error("'start' must be a Date");
    if (!end instanceof Date) throw new Error("'end' must be a Date");
    if (keyBy && !Array.isArray(keyBy))
      throw new Error("'keyBy' must be an array");

    var query = Object.assign(keyBy || {}, {
      "mts__interval.duration": self.interval,
      "mts__interval.start": { $gte: start },
      "mts__interval.end": { $lte: end }
    });

    // console.log(query);

    var index = self.granularity.indexOf(self.interval),
      granulars = self.granularity.slice(0, index + 1);

    var avgs = granulars
      .map(g => {
        return {
          [`avg/${g}`]: { $avg: `$mts__stats.avg.${g}.val` },
          [`forecast/${g}`]: { $addToSet: `$mts__stats.avg.${g}.isForecast` }
        };
      })
      .reduce((a, b) => Object.assign(a, b), {});

    var calcs = {},
      uniques = {};

    if (self.calculations) {
      for (var i in self.calculations) {
        calcs[`calculations/${self.calculations[i]}`] = {
          $push: `$mts__calculations.${self.calculations[i]}`
        };
      }
    }

    if (self.unique) {
      for (var i in self.unique) {
        uniques[`uniques/${self.unique[i]}/arr`] = {
          $push: `$mts__uniques.${self.unique[i]}.arr`
        };
        uniques[`uniques/${self.unique[i]}/count`] = {
          $push: `$mts__uniques.${self.unique[i]}.count`
        };
      }
    }

    // console.log(calcs);
    // console.log(unwinds);
    // console.log()

    var aggs = await self.model
      .aggregate()
      .allowDiskUse(true)
      .match(query)
      .sort("mts__interval.t")
      // .unwind(...unwinds)
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
          avgs,
          calcs,
          uniques
        )
      )
      .project("-_id")

      .exec()
      .catch(console.error);

    // console.log(JSON.stringify(aggs,0,4));
    // console.log(aggs);

    if (!aggs || aggs.length === 0) {
      return resolve(null);
    }

    var stats = {
      overview: {
        doc_count: 0,
        avg: {}
      },
      calculations: {},
      uniques: {},
      timeSeries: aggs[0].timeSeries.filter(a => Object.keys(a).length == 2),
      meta: {
        start: aggs[0].start,
        end: aggs[0].end
      }
    };

    stats.meta.duration = {
      ms: moment(stats.meta.end).diff(moment(stats.meta.start))
    };
    stats.meta.duration.formatted = ms(stats.meta.duration.ms, { long: true });

    granulars.forEach(g => {
      stats.overview.avg[g] = {
        val: Number(aggs[0][`avg/${g}`] || 0).toFixed(3),
        hasForecast: aggs[0][`forecast/${g}`].indexOf(true) > -1
      };
    });

    stats.overview.doc_count = stats.timeSeries.length;

    // stats.calculations = {};

    for (var i in self.calculations) {
      stats.calculations[self.calculations[i]] = ss(
        aggs[0][`calculations/${self.calculations[i]}`].reduce(
          (a, b) => a.concat(b),
          []
        )
      );
    }

    for (var i in self.unique) {
      var uniqueVals = aggs[0][`uniques/${self.unique[i]}/arr`].reduce(
          (a, b) => a.concat(b),
          []
        ).filter(onlyUnique).length,
        count = aggs[0][`uniques/${self.unique[i]}/count`].reduce(
          (a, b) => a + b,
          0
        );

      stats.uniques[self.unique[i]] = {
        unique: uniqueVals,
        duplicated : count - uniqueVals,
        total : count
      };

      // stats.uniques[self.unique[i]].duplicated =
        // count - stats.uniques[self.unique[i]].unique;
    }

    // console.log(stats)

    resolve(stats);
  });
};

function onlyUnique(value, index, self) {
  return self.indexOf(value) === index;
}

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
      var newKey = current ? current + "." + key : key; // joined key with dot
      if (value && typeof value === "object") {
        recurse(value, newKey); // it's a nested object, so do it again
      } else {
        res[newKey] = value; // it's not an object, so set the property
      }
    }
  }

  recurse(obj);
  return res;
}

module.exports = function(mongoose, options) {
  return new a(mongoose, options);
};
