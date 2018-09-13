const mongoose = require("mongoose"),
  moment = require("moment"),
  Analytics = require("../lib/db/analytics");

var Schema = mongoose.Schema;

var sceneHitsSchema = new Schema({
  //these keys are used as uniqueKeys. Advisable that you add them to your indexes
  key: String,
  event: String,

  pos: {
    zoom: Number,
    x: Number
  },

  user :{
    session_id : String
  },

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
    uniqueKeys: ["key", "event"],
    calculations: {
      "pos.zoom": "zoom",
      "pos.x": "x"
    },
    unique : {
      'user.session_id' : 'sess_id'
    }
  },
  analytics = Analytics(mongoose, options);

var SceneHits = mongoose.model("SceneHits");

var doc = {
  key: "233",
  event: "hit",
  pos: {
    zoom: Math.random() * 25,
    x: Math.random() * 80
  },
  user:{
    session_id : Math.random() * 8999
  }
};

/* Save */
analytics
  .save(doc)
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
  .expore(start, end, uniqueKeys)
  .then(resp => {
    console.log(resp);
  })
  .catch(console.error);
S;
