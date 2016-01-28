(function (window, angular, undefined) {
  var module = angular.module,
      extend = angular.extend,
      forEach = angular.forEach;

  module('NrtvTagger', ['api.narrative'])
    .config(function (NarrativeAuthProvider , NarrativeRequestProvider) {
      NarrativeAuthProvider.defaults.oauthApplication = {
        clientID: "GyMRPLNQ4ykI4I3LSaoBaYmELMhV3ft71UVjRjlg",
        redirectURI: window.location.href,
        clientSecret: "nFTgEPU8ol0KT2BxIQTpgd2bUHXtCNh5l5sH0iSKpMmMtNvUPM1V4jOqvD8hd4CtTRRT9qgq2JjMbuPuzeaIM7gSUzm66AhM71ZwQLJmkNgRC0vEQ2opP4mrBhRASo0E"
      };
    })
    .service('ImaggaAuth', function () {
      return {
        // To where the tag requests are to end up.
        endpoint: 'https://api.imagga.com/v1/tagging',

        /**
         * Will return a credentials object, with the token and its type.
         * @return {object} A token object with the type and token set.
         */
        auth: function () {
          return {
            type: 'Basic',
            token: localStorage.getItem('imagga-token')
          };
        },

        /**
         * Checks for the presence of a token in the localStorage.
         * @return {Boolean} Whether a token is present or not.
         */
        hasToken: function () {
          return localStorage.getItem('imagga-token') !== null;
        },

        /**
         * Sets a token in the local storage, stripping the token string of
         * a possible leading 'Basic '
         * @param  {String} token The token to store in localStorage.
         */
        setToken: function(token) {
          if (!token) return;

          if (token.substring(0, 6) === 'Basic ')
            token = token.substring(6);

          localStorage.setItem('imagga-token', token);
        },

        /**
         * Unset the token from the localStorage.
         */
        unsetToken: function () {
          localStorage.removeItem('imagga-token');
        }
      };
    })
    .service('Imagga', function($http, $q, ImaggaAuth) {
      /**
       * Converts an Auth Token object to a header object.
       * @param  {object} auth Auth Token object
       * @return {object}      A header object with Authorization-key set.
       */
      function authToHeader(auth) {
        return {Authorization: auth.type + ' ' + auth.token};
      }

      /**
       * Makes a request to the tag endpoint at Imagga, and deletes the Token
       * if something unexpected is returned.
       * @param  {String} url The URL of the Photo to classify.
       * @return {Promise}    The result promise.
       */
      function tagsRequest(url) {
        return $http.get(ImaggaAuth.endpoint, {
          headers: authToHeader(ImaggaAuth.auth()),
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

      /**
       * Applies a function and concatenates the resulting arrays into one.
       * @param  {Array}    arr  The array to apply the function on.
       * @param  {Function} func The function to apply to each object.
       * @return {Array}         The resulting array.
       */
      function mergeMap(arr, func) {
        return [].concat.apply([], arr.map(func));
      }

      return function (photos) {
        // Clump all photo-promises together, and wait for them all to resolve.
        return $q.all(
          photos.map(tagsRequest)

        // When we reach .then, all promises have resolved and we can work with
        // the results.
        ).then(function (resps) {
          var tags = {}

          // Foreach
          forEach(mergeMap(resps, function (resp) {

            // Return all the tags for fetched data as an array.
            return mergeMap(resp.data.results, function (o) {return o.tags;});
          }), function(o) {
            // Makes sure that we dont have duplicate tags, but add them
            // together instead.
            tags[o.tag] = (tags[o.tag] ? tags[o.tag] : 0) + o.confidence;
          });

          // Return the tags sorted after the confidence in each tag.
          return Object.keys(tags)
            .sort(function(a,b) {return tags[b] - tags[a];})
            .map(function(o) {return {tag: o, confidence: tags[o]}});
        });
      };
    })
    .controller('MainController', function (NarrativeAuth,  NarrativeApi,
                                            Imagga, ImaggaAuth) {
      var main = this;

      main.imaggaAuth = ImaggaAuth;
      main.auth = NarrativeAuth();

      // Wait for a token to come back from Narratives API, so that we
      // can make requests.
      main.auth.waitForAuth().then(function () {
        var api = NarrativeApi();
        main.user = api.me().get();

        // Fetch the logged in users Moments.
        main.moments = api.moments().itemTransform(function(moment) {
          return extend(moment, {imaggaTags: []});
        }).get();
      });

      // Will classify the Moments tags, and apply them to the Moment.
      main.imagga = function (moment) {
        Imagga(moment.cover_photos.map(function(photo) {
          return photo.renders.smartphone.url;
        })).then(function (tags) {
          moment.imaggaTags.push.apply(moment.imaggaTags, tags);
        });
      };

      // Updates the caption of a Moment.
      main.updateCaption = function (moment) {
        var tagString = ' #' + moment.imaggaTags.filter(function (t) {
          return t.active;
        }).map(function(t) {
          return t.tag;
        }).join(' #')

        // This means that no tags were active, so there is no captioning to do
        if (tagString === ' #') return;

        // Returns a promise for which will resolve when the Moment has been
        // updated.
        moment.qUpdate({caption: moment.caption + tagString}).then(function () {
          forEach(moment.imaggaTags, function (tag) {
            tag.active = false;
          });

          // Waits a while before the updated Moment is removed from the list.
          window.setTimeout(function () {
            main.remove(moment);
          }, 2000);
        });
      };

      // Removes a specified Moment from the Moment list, and fetches more
      // if there is too few in the list.
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
