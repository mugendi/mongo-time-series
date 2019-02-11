# Warning
*This is experimental technology. Proceed with caution!*

# What?
Mongo-Time-Series (MTS) is rich Mongo DB time series and analytics module built for [Mongoose](https://mongoosejs.com).

MTS helps you visualize your time series data and attemps to fill in the gaps by making smart data predictions and run summary statistics on select numeric fields.

# Why?
I wanted a module to save analytics sent from the client via [Ahoy.js](https://github.com/ankane/ahoy.js).

I also wanted this data to be well formated for easy exploration on a dashboard. I couldn't find a module that fit my use-case and that was easy to plug into my existing Mongo DB without too much refactoring.

# Getting started
Install the module: ```yarn add mongo-time-series```

## Use Your Existing Schema
MTS is created to easily integrate with your existing schema without requiring you to edit anything.

Let's assume we have the following schema.

```javascript
const mongoose = require("mongoose"),
  moment = require("moment");

//First Create your Schema
var hitsSchema = new mongoose.Schema({
  //these keys are used as keyBy. Advisable that you add them to your indexes
  "userId": String,
  "event": String,

  "pos": {
    "zoom": Number,
    "x": Number
  },

 "user" :{
    "session_id" : String
  },

  //These two keys will be automatically added and populated
  "createdAt": Date,
  "updatedAt": Date
});

//Connect to database and initialize Model
mongoose.connect("mongodb://localhost/analytics");
mongoose.model("HitsSchema", hitsSchema);
```

## Initialize MTS
Now you let MTS know how your schema is structured.

```javascript
const MTS = require("mongo-time-series");

var options = {
    //the schema object as initialized
    schema: hitsSchema,
    schemaName: "HitsSchema",
    //what granularity do we want for our timeseries data?
    interval: "minute",
    //what are the unique keys to identify different documents
    keyBy: ["userId", "event"],
    //numeric keys on witch to run summary statistics
    calculations: {
      "pos.zoom": "zoom",
      "pos.x": "x"
    },

    "unique" : {
      'user.session_id' : 'sess_id'
    }
    

  };

//Initialize MTS. 
var mts = MTS(mongoose, options);

/** 
 * With MTS, we normally don't need to use the Model directly.
 * Unless you have special use-cases, in which case, your analytics may not be saved as expected
**/
//-- var HitsSchema = mongoose.model("HitsSchema");

```

## Save Your Documents through MTS
To ensure that analytics are added to every document you save, you need to do so via MTS as shown below.

```javascript
//this is your document
var doc = { 
    userId: "u-ed-20334", 
    event: "click" ,
    pos: {
        zoom: Math.random() * 25,
        x: Math.random() * 80
    },
    user :{
      session_id : _.random(0, 3434)
    }
};

//Save document
mts.save(doc)
  .then(resp => {
    console.log(resp);
  })
  .catch(console.error);

```

**Note:**
- Instead of creating a new document for every *save* operation, MTS works by updating statistics to the same document till the stipulated *interval* has expired. For example, if ```interval='minute'```, a new document will be created every minute. This approach is well explained [HERE](https://blog.serverdensity.com/mongodb-schema-design-pitfalls).
- ```userId``` and ```event``` were declared as *keyBy*. As such, changing any of these values causes a new document to be created whether or not the *interval* stipulated has expired.

## Explore Your Stats
Having saved your documents, it is now time to explore your data!

```javascript

//Let us explore clicks by user:u-ed-20334 for the last 60 minutes 
var start = moment() .subtract(60, "minutes").toDate(),
  end = moment().toDate(),
  queryObject = { userId: "u-ed-20334", event: "click" };

mts.explore(start, end, queryObject)
  .then(data => {
    console.log(data);
  })
  .catch(console.error);

```

This will output the following:

```json
{                
    "overview": {     
        "doc_count": 46,   
        "avg": {        
            "second": {         
                "val": 3.067,        
                "hasForecast": false   
            },             
            "minute": {     
                "val": 133.152,     
                "hasForecast": true    
            }                
        }                
    },    
    "calculations": {
        "zoom": {
            "num": 541,
            "sum": 6436.832237618005,
            "avg": 11.89802631722367,
            "min": 1.066089178148777,
            "q1": 5.9155911001141925,
            "median": 11.207243010087254,
            "q3": 16.787587622290317,
            "max": 23.86659413642403
        },
        "x": {
            "num": 541,
            "sum": 17967.804374280287,
            "avg": 33.21220771586005,
            "min": 17.571185887429888,
            "q1": 32.48321209248681,
            "median": 32.48321209248681,
            "q3": 41.49306908847892,
            "max": 67.45257542537209
        }
    },  
    "uniques": { 
        "sess_id": { "unique": 313, "duplicated": 20, "total": 333 } 
    },       
    "timeSeries": [ 
        {             
            "t": "09/11/2018 20:28",   
            "val": 119       
        },           
        {             
            "t": "09/11/2018 20:29", 
            "val": 117        
        },  
        ...          
    ],            
    "meta": {     
        "start": "2018-09-11T17:28:42.247Z",   
        "end": "2018-09-11T21:06:03.927Z",  
        "duration": {        
            "ms": 13041680,   
            "formated": "4 hours"
        }               
    }              
}   
```

This data contains all that you need to visualize/explore your saved data.

**Note:**
- ```overview.avg``` key may contain **predicted/forecasted** data. If the average is predicted/forecasted ```overview.avg[granularity].hasForecast``` is set to ```true```.
- having a *true* **hasForecast** value does not mean that all the data used to calculate the average is forecasted but that some of it may have been forecasted.
- averages are calculated for all granularity equal to or smaller than the **interval** entered when initializing MTS. For example, exploring data with an interval of **day** will produce a result with averages for **day, hour** and **second**

## Understanding Forecasted Data
MTS calculates averages based on timestamps saved within the document. (Look at the ```mts__stats.ts``` key in your documents). 

If you have tracked for a period of 30 minutes (first to last timestamp), with your interval set to **hour**, then there isn't enough data to calculate an *per-hour average*. 

All the same, if we get a *per-minute* average of say *10* then the *per-hour* average can be **predicted** with a statistically good level of accuracy.

Because this data is *forecasted* (an estimate at best), it is clearly marked as so. This means that you can decide on how to present such data on your dashboards, or completely ignore the forecasted data.

# API

## Init ```MTS(mongoose, options)```
Initializes an MTS instance. 
- pass an existing mongoose instance (so we know hor to connect, which collection, e.t.c ) alongside your options.

### Options Available
- **schema: (required)** your mongoose schema.
- **schemaName: (optional but recommended)** what name did you give your schema on mongoose. If no name is given, or the name does not represent an initialized mode, then one will be created and named **"MTSSchema"**
- **interval: (optional, default="day")** How granular do you want your time series data to be? Possible values include ***"second", "minute", "hour", "day", "week", "month"*** and ***"year"***
- **keyBy: (optional but recommended)** An array of keys within your schema should be used to determine if a new document should be created. For example, if your intend to track data based on a user, then include user-id as a unique key. Because these keys are used a lot by MTS, it is recommended that you index each of them.
- **calculations: (optional)** an object containing keys on which summary statistics are calculated. while entering the calculations object, ensure that the *field name* is entered as the key with its *value* being the document path in final analytics result. For example, the example above returns analytics for **pos.zoom** as **calculations.zoom**. If the calculations object was ```{"data.nested.foo":"bar"}``` MTS will return ```{"calculations.bar" : {...summary stats}}``` from ```{data:{nested:{foo:23}}}```.

- **uniques: (optional) an object of keys that you want to aggregate uniqueness on. This is important for tracking things like unique users where you pass the users session ID and exploring the data will give tell you how many session id's were unique and how many were not.

- **tsArraySize: (optional, default=500)** determines the maximum number of time-stamps stored within each document for aggregation. Only the most recent time-stamps are retained to ensure that documents are not too big. If you should alter this value, understand that the time-stamps you have, the less accurate your data will be. Also a very high number will mean your documents could get too large and impact on aggregation and document saving drastically.

## Save ```.save(doc)```
Saves your document. In actual sense, MTS either updates an existing document or creates a new one if **interval** has elapsed or **keyBy** have changed.

## Explore ```explore(start, end, [queryObject])```
Resolves with aggregated time series data. 
- **start** and **end** must be valid date values.


# To Do
- Better documentation (this was very hurriedly put up)
- Add more stats






