// simple-todos.js
Circles = new Mongo.Collection("circles");
CircleMessages = new Mongo.Collection("circlemessages");

Router.route('/', function() {
  this.render('Home');
})

Router.route('topic/:topicId', function() {
  this.render('TopicDiscussion', {data: {id: this.params.topicId}});
})

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
          return matchText.replace(regExp, "<b>$&</b>")
        },
        sort: {isoScore: -1}
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
    Meteor.subscribe('topics');
    Meteor.subscribe('topicmessages', this.data.id);
  };
  Template.TopicDiscussion.events({
    'submit .message-form': function(event) {
      try {
        var topic = Session.get('topic');
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
    }
  });
  Template.TopicDiscussion.helpers({
    getTopic: function() {
      return Session.get('topic');
    },
    getMessages: function() {
      var topic = Session.get('topic');
      return CircleMessages.find({circle: topic && topic._id}, {sort: [['createdAt', 'asc']]});
//      return Meteor.call('getCircleMessages', topic && topic._id);
    }
  });
}


if (Meteor.isServer) {
  SearchSource.defineSource('topics', function(searchText, options) {
    var options = {sort: [['latestPostAt', 'desc'], ['createdAt', 'desc']], limit: 20};

    if(searchText) {
      console.log('About to search circles for', searchText, '...');
      var regExp = buildRegExp(searchText);
      var selector = {$and: [{closed: {$ne: true}}, {archived: {$ne: true}}, {$or: [
        {title: regExp},
        {description: regExp}
      ]}]};

      return Circles.find(selector, options).fetch();
    } else {
      console.log('About to call Circles.find for all...');
      return Circles.find({closed: {$ne: true}, archived: {$ne: true}}, options).fetch();
    }
  });


  function buildRegExp(searchText) {
    // this is a dumb implementation
    var parts = searchText.trim().split(/[ \-\:]+/);
    return new RegExp("(" + parts.join('|') + ")", "ig");
  }

  Meteor.publish("topics", function() {
    return Circles.find({$and: [{closed: {$ne: true}}, {archived: {$ne: true}}]}, {sort: [['latestPostAt', 'desc'], ['createdAt', 'desc']]});
  });
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
  if(circle.closed && (circle.creator == userId || circle.owner == userId || !circle.members || !circle.members.find(function(e) {e.userId == userId}))) {
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

    return Circles.insert({
      title: options.title,
      description: options.description,
      closed: options.closed,
      createdAt: new Date(),
      latestPostAt: new Date(),
      creator: Meteor.userId(),
      creatorUsername: Meteor.user().username,
      owner: Meteor.userId(),
      ownerUsername: Meteor.user().username,
    });
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
        userId: userId,
        username: Meteor.user().username,
        alias: Meteor.user().username,
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