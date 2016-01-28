(function (window, angular, undefined) {
  var module = angular.module,
      extend = angular.extend,
      forEach = angular.forEach;

  module('NarrativeImagga', ['api.narrative'])
    .config(function (NarrativeAuthProvider , NarrativeRequestProvider) {
      NarrativeAuthProvider.defaults.oauthApplication = {
        clientID: "GyMRPLNQ4ykI4I3LSaoBaYmELMhV3ft71UVjRjlg",
        redirectURI: window.location.href,
        clientSecret: "nFTgEPU8ol0KT2BxIQTpgd2bUHXtCNh5l5sH0iSKpMmMtNvUPM1V4jOqvD8hd4CtTRRT9qgq2JjMbuPuzeaIM7gSUzm66AhM71ZwQLJmkNgRC0vEQ2opP4mrBhRASo0E"
      };
    })
    .service('ImaggaAuth', function () {
      return {
        endpoint: 'https://api.imagga.com/v1/tagging',
        auth: function () {
          return {
            type: 'Basic',
            token: localStorage.getItem('imagga-token')
          };
        },
        hasToken: function () {
          return localStorage.getItem('imagga-token') !== null;
        },
        setToken: function(token) {
          if (!token) return;

          if (token.substring(0, 6) === 'Basic ')
            token = token.substring(6);

          localStorage.setItem('imagga-token', token);
        },
        unsetToken: function () {
          localStorage.removeItem('imagga-token');
        }
      };
    })
    .service('Imagga', function($http, $q, ImaggaAuth) {
      function authToHeader(auth) {
        return auth.type + ' ' + auth.token;
      }

      function tagsRequest(url) {
        return $http.get(ImaggaAuth.endpoint, {
          headers: {Authorization: authToHeader(ImaggaAuth.auth())},
          params: {url: url}
        }).then(function (result) {
          if (result.status !== 200) {
            ImaggaAuth.unsetToken();
            return $q.reject('Imagga token broke');
          }
          return result;
        }, function (error) {
          ImaggaAuth.unsetToken();
          return $q.reject('Imagga token broke');
        })
      }

      function mergeMap(arr, func) {
        return [].concat.apply([], arr.map(func));
      }

      return function (photos) {
        return $q.all(
          photos.map(tagsRequest)
        ).then(function (resps) {
          var tags = {}
          forEach(mergeMap(resps, function (resp) {
            return mergeMap(resp.data.results, function (o) {return o.tags;});
          }), function(o) {
            tags[o.tag] = (tags[o.tag] ? tags[o.tag] : 0) + o.confidence;
          });

          return Object.keys(tags)
            .sort(function(a,b) {return tags[b] - tags[a];})
            .map(function(o) {return {tag: o, confidence: tags[o]}});
        });
      };
    })
    .controller('MainController', function (NarrativeAuth,  NarrativeApi, Imagga,
                                            ImaggaAuth) {
      var main = this;

      main.imaggaAuth = ImaggaAuth;

      main.auth = NarrativeAuth();
      main.auth.waitForAuth().then(function () {
        var api = NarrativeApi();
        main.user = api.me().get();
        main.moments = api.moments().itemTransform(function(moment) {
          return extend(moment, {imaggaTags: []});
        }).get();
      });

      main.imagga = function (moment) {
        Imagga(moment.cover_photos.map(function(photo) {
          return photo.renders.smartphone.url;
        })).then(function (tags) {
          moment.imaggaTags.push.apply(moment.imaggaTags, tags);
        });
      };

      main.updateCaption = function (moment) {
        var tagString = ' #' + moment.imaggaTags.filter(function (t) {
          return t.active;
        }).map(function(t) {
          return t.tag;
        }).join(' #')

        if (tagString === ' #') return;

        moment.qUpdate({caption: moment.caption + tagString}).then(function () {
          forEach(moment.imaggaTags, function (tag) {
            tag.active = false;
          });

          window.setTimeout(function () {
            main.remove(moment);
          }, 2000);
        });
      };

      main.remove = function (moment) {
        var index = main.moments.results.indexOf(moment);
        if (index >= 0) {
          main.moments.results.splice(index, 1);
          if (main.moments.results.length < 5) {
            main.moments.nextPage();
          }
        }
      };
    });

}(window, window.angular));
