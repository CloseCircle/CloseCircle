// simple-todos.js
Circles = new Mongo.Collection("circles");
CircleMessages = new Mongo.Collection("circlemessages");

Router.route('/', function() {
  this.render('Home');
})

Router.route('topic/:topicId', function() {
  this.render('TopicDiscussion', {data: {id: this.params.topicId}});
})


// We love hacky places to put ployfills!
if (!Array.prototype.find) {
  Array.prototype.find = function(predicate) {
    if (this == null) {
      throw new TypeError('Array.prototype.find called on null or undefined');
    }
    if (typeof predicate !== 'function') {
      throw new TypeError('predicate must be a function');
    }
    var list = Object(this);
    var length = list.length >>> 0;
    var thisArg = arguments[1];
    var value;

    for (var i = 0; i < length; i++) {
      value = list[i];
      if (predicate.call(thisArg, value, i, list)) {
        return value;
      }
    }
    return undefined;
  };
}



if(Meteor.isClient) {
  var options = {
    keepHistory: 1000 * 60 * 5,
    localSearch: true
  };
  var fields = ['title', 'description'];

  TopicSearch = new SearchSource('topics', fields, options);
  Template.Home.helpers({
    getTopics: function() {
      return TopicSearch.getData({
        transform: function(matchText, regExp) {
          return matchText.replace(regExp, "<u>$&</u>")
        },
        sort: [['closed', 'desc'], ['isoScope', 'desc']]
      });
    },

    isLoading: function() {
      return TopicSearch.getStatus().loading;
    }
  });
  Template.Home.events({
    'keyup #title': _.throttle(function(event) {
        var text = $(event.target).val().trim();
        TopicSearch.search(text);
      }, 100),
    'submit #searchform': function(event) {
      Meteor.call('addCircle', {title: event.target.title.value, closed: false}, function(err, ret) {
        if(err) console.error('Error in addCircle', err, err.stack);
        TopicSearch.search('');
      });
      event.target.title.value = '';
    }
/*    'click #add': function(event) {

      Meteor.call('addCircle', {title: $("#title").val(), closed: false});

      $("#title").val("");
    },*/
  });
  Accounts.ui.config({
    passwordSignupFields: "USERNAME_ONLY"
  });
  Template.Home.rendered = function() {
    TopicSearch.search('');
  };
  Template.TopicDiscussion.rendered = function() {
    Meteor.call('getCircle', this.data.id, function(err, ret) {
      if(err) return console.error('Error from getCircle:', err, err.stack);
      console.log('Setting topic for', this.data.id, 'to', ret);
      Session.set('topic', ret);
    }.bind(this))
//    Meteor.subscribe('topics');
    Meteor.subscribe('topicmessages', this.data.id);
  };
  Template.TopicDiscussion.events({
    'submit .message-form': function(event) {
      try {
        var topic = Session.get('topic');
        if(!event.target.text.value) return false;
        Meteor.call('addMessage', {text: event.target.text.value, circleId: topic && topic._id}, function (err, ret) {
          if (err) console.error('Error while calling addMessage', err, err.stack);
          else {
            event.target.text.value = '';
          }
        });
        return false;
      } catch(err) {
        console.error('Error while submitting message.', err, err.stack);
        return false;
      }
    },
    'click #closecircle': function(event) {
      $('select').select2();
    }
  });
  Template.TopicDiscussion.helpers({
    getTopic: function() {
      return Session.get('topic');
    },
    getMessages: function() {
      var topic = Session.get('topic');
      console.log('In getMessages');
      return CircleMessages.find({circle: topic && topic._id}, {sort: [['createdAt', 'asc']]});
//      return Meteor.call('getCircleMessages', topic && topic._id);
    }
  });

  Template.message.rendered = function() {
    var d = $("#messages").get(0);
    d.scrollTop = d.scrollHeight;
  };

  Template.groupSelect.events({
    'click #inviteBtn': function(event) {
      try {
        console.log('mtk2 /-/ made it!');
        var selectedChoices = $("#groupMembers").val();
        if(!selectedChoices || !selectedChoices.length) {
           return false;
        }
        console.log('selectedChoices:', selectedChoices);
        selectedChoices = selectedChoices.map(function(str) {var split = str.split('|'); return {userId: split[0], username: split[1], alias: split[1]}});
        var topic = Session.get('topic');

        Meteor.call('createCloseCircle' /*?*/, {title: topic.title, parentCircleId: topic._id, memberList: selectedChoices}, function (err, ret) {
          if (err) console.error('Error while calling createCloseCircle', err, err.stack);
          else {
            selectedChoices.each(function() {
              $(this).remove();
            });
          }
        });
        return false;
      } catch(err) {
        console.error('Error while submitting message.', err, err.stack);
        return false;
      }
    },
    'click #groupsSelectClose': function(event) {
      // We all love hacks!!
      location.reload();
    }
  });
  Template.groupSelect.helpers({
    getUserList: function() {
      var thisCircle = Session.get('topic');
      if(!thisCircle) return;
      var circleId = thisCircle._id;
      var users = CircleMessages.find({$and: [{circle: circleId}, {user: {$ne: Meteor.userId()}}]})
          .map(function(e) {return {_id: e.user, username: e.useralias}})
          .reduce(function(pvalue, e) {if(!pvalue.find(function(pe) {return pe._id == e._id})) pvalue.push(e); return pvalue;}, []);
      console.log('getRecentUsersForCircle', circleId, 'returning:', users);
      return users;
//      return Meteor.call('getRecentUsersForCircle', thisCircle._id);
    }
  });
}


if (Meteor.isServer) {
  SearchSource.defineSource('topics', function(searchText, options) {
    var options = {sort: [['closed', 'desc'], ['latestPostAt', 'desc'], ['createdAt', 'desc']], limit: 20};

    if(searchText) {
      console.log('About to search circles for', searchText, '...');
      var regExp = buildRegExp(searchText);
      // archived != true AND ((closed != true AND (title matches OR description matches)) OR (closed = true AND you are member))
      var selector = {$and: [{archived: {$ne: true}},
        {$or: [
          {$and: [{closed: {$ne: true}}, {$or: [
            {title: regExp},
            {description: regExp}
          ]}]},
          {$and: [{closed: true}, {members: {$elemMatch: {userId: Meteor.userId()}}}, {$or: [
            {title: regExp},
            {description: regExp}
          ]}]}
        ]}]};

      var ret = Circles.find(selector, options).fetch();
    } else {
      console.log('About to call Circles.find for all...');
      var selector = {$and: [{archived: {$ne: true}},
        {$or: [
          {closed: {$ne: true}},
          {$and: [{closed: true}, {members: {$elemMatch: {userId: Meteor.userId()}}}]}
        ]}]}
      var ret = Circles.find(selector, options).fetch();
    }

    var userId = Meteor.userId();
    return ret.map(function(e) {
      if(e.closed && e.owner == userId) {
        e.title = '* ' + e.title;
      } else if(e.closed) {
        e.title = '* ' + e.title;
      }
      return e;
    });
  });


  function buildRegExp(searchText) {
    // this is a dumb implementation
    var parts = searchText.trim().split(/[ \-\:]+/);
    return new RegExp("(" + parts.join('|') + ")", "ig");
  }

//  Meteor.publish("topics", function() {
//    return Circles.find({$and: [{closed: {$ne: true}}, {archived: {$ne: true}}]}, {sort: [['latestPostAt', 'desc'], ['createdAt', 'desc']]});
//  });
  Meteor.publish('usertopics', function() {
    return Circles.find({archived: {$ne: true}}, {sort: [['latestPostAt', 'desc'], ['createdAt', 'desc']]});
  });
  Meteor.publish('topicmessages', function(circleId) {
    // Todo: this needs security.
    return CircleMessages.find({circle: circleId}, {sort: [['createdAt', 'desc']]});
  });
//  Meteor.publish("messages", function(topicId) {
//    return Messages.find({$and: []})
//  });
}

function userMustBeLoggedIn()
{
  if(!Meteor.userId()) {
    throw new Meteor.Error("not-authorized");
  }
}


function userMustBeMemberOfCircle(circle)
{
  var userId = Meteor.userId();
  if(circle.closed && (!circle.members || !circle.members.find(function(e) {return e.userId == userId}))) {
    console.log('circle:', circle, '- userId:', userId);
    throw new Meteor.Error('You are not a member of this closed circle. not-authorized.');
  }
}

Meteor.methods({
  getCircle: function(circleId) {
    if(Meteor.isClient) return;
    var circle = Circles.findOne(circleId);
    if(!circle) {
      throw new Meteor.Error('Unable to find circle ' + circleId);
    }
    if(circle && !circle.closed) {
      console.log('getCircle', circleId, 'returning open circle', circle);
      return circle;
    } else {
      userMustBeLoggedIn();
      userMustBeMemberOfCircle(circle);
      return circle;
    }
  },

  addCircle: function(options) {
    userMustBeLoggedIn();

    console.log("I'm in addCircle", options);

    var circleId = new Meteor.Collection.ObjectID().valueOf();
    Circles.insert({
      _id: circleId,
      title: options.title,
      description: options.description,
      closed: options.closed,
      createdAt: new Date(),
      latestPostAt: new Date(),
      creator: Meteor.userId(),
      creatorUsername: Meteor.user().username,
      owner: Meteor.userId(),
      ownerUsername: Meteor.user().username,
      members: [{
        userId: Meteor.userId(),
        username: Meteor.user().username,
        alias: Meteor.user().username,
        addedAt: new Date()
      }]
    });

    if(options.members && options.members.length) {
      for(var i = 0;i < options.members.length;++i) {
        Meteor.call('addMemberToCircle', {circleId: circleId, userId: options.members[i].userId, username: options.members[i].username, alias: options.members[i].alias});
      }
    }

    return circleId;
  },

  archiveCircle: function(circleId) {
    userMustBeLoggedIn();

    Circles.update(circleId, {$set: {archived: true}});
  },

  addMemberToCircle: function(options) {
    userMustBeLoggedIn();

    var circle = Circles.findOne(options.circleId);
    var userId = Meteor.userId();
    if(circle.owner != userId) {
      throw new Meteor.Error('Only the owner can add a member to this circle. not-authorized.');
    }

    return Circles.update(options.circleId, {$addToSet: {
      members: {
        userId: options.userId || userId,
        username: options.username || Meteor.user().username,
        alias: options.alias || Meteor.user().username,
        addedAt: new Date()
      }
    }});
  },


  addMessage: function(options) {
    userMustBeLoggedIn();

    var circle = Circles.findOne(options.circleId);
    if(circle.closed) {
      userMustBeMemberOfCircle(circle);
    }

    return CircleMessages.insert({
      text: options.text,
      createdAt: new Date(),
      user: Meteor.userId(),
      username: Meteor.user().username,
      useralias: Meteor.user().username, // TODO: implement actual anon/alias functionality
      circle: options.circleId
    });
  },

  createCloseCircle: function(options) {
    if (!options.title || !options.memberList || !options.parentCircleId) return; //?

    /*TODO:
    if (circleAlreadyExists) {
      takeToCircle();
      return;
    }
    */

    Meteor.call('addCircle', {title: options.title, members: options.memberList, parentCircleId: options.parentCircleId, closed: true /*parentCircle: parentCircle ?*/});  // needs to be private/hidden
  },

  getRecentUsersForCircle: function(circleId) {
    //Meteor.users.find({_id: {$in: CircleMessages.distinct('user', {circle: circleId})}})
    var userIds = CircleMessages.find({circle: circleId}).map(function(e) {return e.user}).reduce(function(pvalue, e) {if(pvalue.indexOf(e) === -1) pvalue.push(e); return pvalue;}, []);
    // TODO: this should return aliases...
    console.log('getRecentUsersForCircle', circleId, ':', userIds);
    var users = Meteor.users.find({_id: {$in: userIds}});
    console.log('getRecentUsersForCircle', circleId, 'returning:', users);
    return users;
  },

  getCircleMessages: function(circleId) {
/*    userMustBeLoggedIn();
    var circle = Circles.findOne(circleId);
    if(!circle) {
      throw new Meteor.Error('Circle id does not exist.');
    }
    if(circle.closed) {
      userMustBeMemberOfCircle(circle);
    }
    console.log('About to call Messages.find with', circleId); */
    return CircleMessages.find({circle: circleId}, {sort: [['createdAt', 'asc']]});
  }
});