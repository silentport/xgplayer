import 'core-js/modules/es6.promise.js'
import 'core-js/modules/es7.string.pad-start'
import Player from 'xgplayer'
import DASH from './dash'
import MSE from './media/mse'
import Task from './media/task'

const isEnded = (player, dash) => {
  if (dash.type === 'vod') {
    if (player.duration - player.currentTime < 2) {
      const range = player.getBufferedRange()
      if (player.currentTime - range[1] < 0.1) {
        // console.log('player.mse.endOfStream')
        player.mse.endOfStream()
      }
    }
  }
}

let errorHandle = (player, err) => {
  err.vid = player.config.vid
  err.url = player.src
  if (err.errd && typeof err.errd === 'object') {
    if (player.dash) {
      err.errd.url = player.dash.url
      err.url = player.dash.url
      // player.dash.canDownload = false
    }
  }
  player.emit('DATA_REPORT', err)
  if (err.errt === 'network' && player.config._backupURL) {
    player.src = player.config._backupURL
  } else {
    player.src = player.config._mainURL
  }
  player.switchURL = null
  player._replay = null
}

class DashPlayer extends Player {
  constructor (options) {
    super(options)

    let player = this
    let sniffer = Player.sniffer
    let definations = []

    const preloadTime = player.config.preloadTime || 15
    if (['chrome', 'firfox', 'safari'].some(item => item === sniffer.browser) && MSE.isSupported('video/mp4; codecs="avc1.64001E, mp4a.40.5"')) {
      const _start = player.start
      let dash
      Object.defineProperty(player, 'src', {
        get () {
          return player.currentSrc
        },
        set (url) {
          player.config.url = url
          if (!player.paused) {
            player.pause()
            player.once('pause', () => {
              player.start(url)
            })
            player.once('canplay', () => {
              player.play()
            })
          } else {
            player.start(url)
          }
          player.once('canplay', () => {
            player.currentTime = 0
          })
        },
        configurable: true
      })
      player.start = function (url = player.config.url) {
        if (!url) { return }
        if (player.config.dashOpts && player.config.dashOpts.drm) {
          if (!navigator.requestMediaKeySystemAccess) {
            console.log('EME API is not supported. Enable pref media.eme.enabled to true in about:config')
            return
          }
        }
        dash = new DASH(url, player.config, player.video)
        dash.init(url).then((res) => {
          dash.mpd.mediaList['video'].forEach((item) => {
            definations.push({
              name: item.height + 'P',
              url: item.id,
              selected: false
            })
          })
          definations[0].selected = true
          player.emit('resourceReady', definations)

          let mse = res
          _start.call(player, mse.url)
          player.dash = dash
          player.mse = mse
          dash.on('error', err => {
            errorHandle(player, err)
          })

          player.switchURL = (Idx) => {
            Idx = Idx.split('/')[Idx.split('/').length - 1]
            let vl = dash.mpd.mediaList['video']
            let newIdx = vl.selectedIdx

            vl.every((item, index) => {
              if (item.id === Idx) {
                newIdx = index
                dash.getData(vl[newIdx].initSegment).then(function (videoInitRes) {
                  switchBW(videoInitRes)
                })
                return false
              } else {
                return true
              }
            })

            function switchBW (videoInitRes) {
              let curTime = player.currentTime
              let temp = vl[vl.selectedIdx].mediaSegments.find(item => item.start - curTime > 6)
              let start = temp.start
              let end = player.getBufferedRange()[1]
              if (end - start > 0 && sniffer.browser !== 'safari') {
                player.mse.removeBuffer(`${vl[0].mimeType};codecs="${vl[0].codecs}"`, start, end)
              }
              vl[vl.selectedIdx].mediaSegments.every(item => {
                item.downloaded = false
                return true
              })
              player.mse.appendBuffer(`${vl[0].mimeType};codecs="${vl[0].codecs}"`, videoInitRes)
              player.mse.once(`${vl[0].mimeType};codecs="${vl[0].codecs}" updateend`, function () {
                vl[newIdx].inited = true
                vl.selectedIdx = newIdx
                loadData((temp.start + temp.end) / 2)
              })
            }
          }

          function timeupdateFunc () {
            loadData(player.currentTime + 1)
            isEnded(player, dash)
          }

          player.on('timeupdate', timeupdateFunc)

          player.on('seeking', () => {
            loadData()
          })

          function waitingFunc () {
            if (dash.type === 'live') {
              // let buffered = player.buffered
              // let length = buffered.length
              // let currentTime = player.currentTime
              // for (let i = 0; i < length; i++) {
              //   if (buffered.start(i) > currentTime) {
              //     player.currentTime = buffered.start(i) + 0.1
              //     break
              //   }
              // }
            } else {
              loadData()
            }
          }

          player.on('waiting', waitingFunc)

          player.on('ended', () => {
            player.off('waiting', waitingFunc)
            player.off('timeupdate', timeupdateFunc)
          })

          player.once('destroy', () => {
            clearTimeout(dash.mpd.timer)
          })

          player._replay = function () {
            Task.clear()
            dash = new DASH(url, player.config, player.video)
            dash.init(url).then((result) => {
              definations[0].selected = true
              player.emit('resourceReady', definations)
              let mse = result
              _start.call(player, mse.url)
              player.dash = dash
              player.mse = mse
              player.currentTime = 0
              player.play()
              player.once('canplay', () => {
                player.on('waiting', waitingFunc)
                player.on('timeupdate', timeupdateFunc)
              })
            }, err => {
              errorHandle(player, err)
            })
          }
        }, err => {
          errorHandle(player, err)
          _start.call(player, url)
        })
        player.download = () => {
          dash.download()
        }
      }

      const loadData = (time = player.currentTime) => {
        const range = player.getBufferedRange()
        if (time < range[1]) {
          if (dash.type === 'vod') {
            if (range[1] - time < preloadTime) {
              dash.seek(range[1] + 1)
            }
          }
        } else {
          dash.seek(time)
        }
      }
    }
  }
}

module.exports = DashPlayer
