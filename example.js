const mongoose = require("mongoose"),
  moment = require("moment"),
  Analytics = require("../lib/db/analytics");

var Schema = mongoose.Schema;

var sceneHitsSchema = new Schema({
    //these keys are used as uniqueKeys. Advisable that you add them to your indexes
  key: String,
  event: String,

  //These two keys will be automatically added and populated
  createdAt: Date,
  updatedAt: Date
});

mongoose.connect("mongodb://localhost/analytics");
mongoose.model("SceneHits", sceneHitsSchema);

var options = {
    schema: sceneHitsSchema,
    schemaName: "SceneHits",
    interval: "minute",
    uniqueKeys: ["key", "event"]
  },
  analytics = Analytics(options);

var SceneHits = mongoose.model("SceneHits");

var doc = { key: "233", event: "hit" };

/* Save */
analytics
  .saveStat(doc)
  .then(resp => {
    console.log(resp);
  })
  .catch(console.error);
  

/* Explore */
var start = moment()
    .subtract(600, "minutes")
    .toDate(),
  end = moment().toDate(),
  uniqueKeys = { key: "233", event: "hit" };

analytics
  .exporeStat("minute", start, end, uniqueKeys)
  .then(resp => {
    console.log(resp);
  })
  .catch(console.error);
S;
