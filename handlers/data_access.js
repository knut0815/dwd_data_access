// dwd_data_access
//
// Copyright 2018 The dwd_data_access Developers. See the LICENSE file at
// the top-level directory of this distribution and at
// https://github.com/UdSAES/dwd_data_access/LICENSE
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
//
// dwd_data_access may be freely used and distributed under the MIT license

'use strict'

const path = require('path')
const moment = require('moment')
const csv = require('dwd-csv-helper')
const _ = require('lodash')
const {
  convertUnit
} = require('../lib/unit_conversion.js')
const gf = require('../lib/grib_functions')

// Instantiate logger
const processenv = require('processenv')
const LOG_LEVEL = String(processenv('LOG_LEVEL') || 'info')

var bunyan = require('bunyan')
var log = bunyan.createLogger({
  name: 'handler_non-cached_data_access',
  level: LOG_LEVEL,
  serializers: bunyan.stdSerializers
})
log.info('loaded module for handling requests for non-cached data')

// GET /weather/cosmo/d2/:referenceTimestamp/:voi?lat=...&lon=...
function getWeatherCosmoD2 (WEATHER_DATA_BASE_PATH, voisConfigs) {
  return async function (req, res, next) {
    const referenceTimestamp = parseInt(req.params.referenceTimestamp)
    const voi = req.params.voi
    const lat = parseFloat(req.query.lat)
    const lon = parseFloat(req.query.lon)

    const gribBaseDirectory = path.join(WEATHER_DATA_BASE_PATH, 'weather', 'cosmo-d2', 'grib')

    try {
      const voiConfig = _.find(voisConfigs, (item) => {
        return item.target.key === voi
      })

      let timeseriesData
      if (voiConfig.cosmo.functionType === 'loadBaseValue') {
        timeseriesData = await gf['loadBaseValue']({
          gribBaseDirectory,
          referenceTimestamp,
          voi: voiConfig.cosmo.options.key,
          location: {
            lat,
            lon
          },
          sourceUnit: voiConfig.cosmo.options.unit,
          targetUnit: voiConfig.target.unit
        })
      } else if (voiConfig.cosmo.functionType === 'loadRadiationValue') {
        timeseriesData = await gf['loadRadiationValue']({
          gribBaseDirectory,
          referenceTimestamp,
          voi: voiConfig.cosmo.options.key,
          location: {
            lat,
            lon
          },
          sourceUnit: voiConfig.cosmo.options.unit,
          targetUnit: voiConfig.target.unit
        })
      } else if (voiConfig.cosmo.functionType === 'load2DVectorNorm') {
        timeseriesData = await gf['load2DVectorNorm']({
          gribBaseDirectory,
          referenceTimestamp,
          voi1: voiConfig.cosmo.options.voi1_key,
          voi2: voiConfig.cosmo.options.voi2_key,
          location: {
            lat,
            lon
          },
          sourceUnit1: voiConfig.cosmo.options.voi1_unit,
          sourceUnit2: voiConfig.cosmo.options.voi2_unit,
          targetUnit: voiConfig.target.unit
        })
      } else if (voiConfig.cosmo.functionType === 'load2DVectorAngle') {
        timeseriesData = await gf['load2DVectorAngle']({
          gribBaseDirectory,
          referenceTimestamp,
          voi1: voiConfig.cosmo.options.voi1_key,
          voi2: voiConfig.cosmo.options.voi2_key,
          location: {
            lat,
            lon
          },
          sourceUnit1: voiConfig.cosmo.options.voi1_unit,
          sourceUnit2: voiConfig.cosmo.options.voi2_unit,
          targetUnit: voiConfig.target.unit
        })
      }

      const result = {
        label: voiConfig.target.key,
        unit: voiConfig.target.unit,
        data: timeseriesData.timeseriesData,
        location: timeseriesData.location
      }
      res.status(200).send(result)
      log.info('successfully handled ' + req.method + '-request on ' + req.path)
    } catch (error) {
      log.warn(error, 'error while handling ' + req.method + '-request on ' + req.path)
      res.status(500).send()
    }
  }
}

// GET /weather/local_forecasts/poi/:referenceTimestamp/:sid/:voi
function getWeatherMosmix (WEATHER_DATA_BASE_PATH, voisConfigs) {
  const MOSMIX_DATA_BASE_PATH = path.join(WEATHER_DATA_BASE_PATH, 'weather', 'local_forecasts')

  return async function (req, res, next) {
    const referenceTimestamp = parseInt(req.params.referenceTimestamp)
    const sid = req.params.sid
    const voi = req.params.voi

    try {
      const timeseriesDataCollection = await csv.readTimeseriesDataMosmix(MOSMIX_DATA_BASE_PATH, referenceTimestamp, sid)
      const voiConfig = _.find(voisConfigs, (item) => {
        return item.target.key === voi
      })

      let timeseriesData
      if (!_.isNil(_.get(voiConfig, ['mosmix', 'key']))) {
        timeseriesData = timeseriesDataCollection[voiConfig.mosmix.key]
        timeseriesData = _.map(timeseriesData, (item) => {
          return {
            timestamp: item.timestamp,
            value: convertUnit(item.value, voiConfig.mosmix.unit, voiConfig.target.unit)
          }
        })
      } else {
        res.status(500).send()
      }

      const result = {
        label: voiConfig.target.key,
        unit: voiConfig.target.unit,
        data: timeseriesData
      }
      res.status(200).send(result)
      log.info('successfully handled ' + req.method + '-request on ' + req.path)
    } catch (error) {
      log.warn(error, 'error while handling ' + req.method + '-request on ' + req.path)
      res.status(500).send()
    }
  }
}

// GET /weather/weather_reports/poi/:sid/:voi?startTimestamp=...&endTimestamp=...
function getWeatherReport (WEATHER_DATA_BASE_PATH, voisConfigs) {
  const REPORT_DATA_BASE_PATH = path.join(WEATHER_DATA_BASE_PATH, 'weather', 'weather_reports')

  return async function (req, res, next) {
    let startTimestamp = parseInt(req.query.startTimestamp)
    let endTimestamp = parseInt(req.query.endTimestamp)
    const sid = req.params.sid
    const voi = req.params.voi

    if (isNaN(startTimestamp)) {
      startTimestamp = moment.utc().subtract(25, 'hours').valueOf()
    }

    if (isNaN(endTimestamp)) {
      endTimestamp = moment.utc().valueOf()
    }

    try {
      const timeseriesDataCollection = await csv.readTimeseriesDataReport(REPORT_DATA_BASE_PATH, startTimestamp, endTimestamp, sid)
      const voiConfig = _.find(voisConfigs, (item) => {
        return item.target.key === voi
      })

      if (_.isNil(_.get(voiConfig, ['report', 'key']))) {
        res.status(500).send('received request for REPORT for unconfigured VOI')
        log.warn('received request for REPORT for unconfigured VOI')
        return
      }

      let timeseriesData = timeseriesDataCollection[voiConfig.report.key]

      // Find timestamps for which at least one value is null and attempt to
      // find a timestamp for which the value is not null
      const timestampsToRemove = []
      _.forEach(timeseriesData, (item) => {
        // Skip item if value is not null
        if (!_.isNil(item.value)) {
          return
        }

        // If value is null, check if there exists another item with the same
        // timestamp which has a value that is not null; return true xor false
        const betterItem = _.find(timeseriesData, (item2) => {
          return item2.timestamp === item.timestamp && !_.isNil(item2.value)
        })

        // If betterItem is true, keep the timestamp; nominate timestamp
        // for removal otherwise
        if (!_.isNil(betterItem)) {
          timestampsToRemove.push(item.timestamp)
        }
      })

      // Remove items for which no value exists at timestamp
      _.remove(timeseriesData, (item) => {
        return _.includes(timestampsToRemove, item.timestamp) && _.isNil(item.value)
      })

      if (!_.isNil(voiConfig)) {
        timeseriesData = _.map(timeseriesData, (item) => {
          return {
            timestamp: item.timestamp,
            value: convertUnit(item.value, voiConfig.report.unit, voiConfig.target.unit)
          }
        })
      }

      const result = {
        label: voiConfig.target.key,
        unit: voiConfig.target.unit,
        data: timeseriesData
      }
      res.status(200).send(result)
      log.info('successfully handled ' + req.method + '-request on ' + req.path)
    } catch (error) {
      log.warn(error, 'error while handling ' + req.method + '-request on ' + req.path)
      res.status(500).send()
    }
  }
}

exports.getWeatherCosmoD2 = getWeatherCosmoD2
exports.getWeatherMosmix = getWeatherMosmix
exports.getWeatherReport = getWeatherReport
