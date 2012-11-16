$(function () {

    var xhrerror = function (xhr, status, error) {
        console.log(this.name + ": error " + status + ":" + error);
    };

    function getQuery(query) {
        query = query.replace(/[\[]/, "\\\[").replace(/[\]]/, "\\\]");
        var expr = "[\\?&]" + query + "=([^&#]*)";
        var regex = new RegExp(expr);
        var results = regex.exec(window.location.href);
        if (results !== null) {
            return decodeURIComponent(results[1].replace(/\+/g, " "));
        } else {
            return false;
        }
    }

    function hudsonapi(url, success, error) {
        if (!url.match("/$")) {
            url = url + "/";
        }

        $.ajax({
            url:url + "api/json",
            dataType:"jsonp",
            jsonp:"jsonp",
            success:success,
            error:error
        })
    }

    function Build(data) {
      this.data = data;
    }

    Build.prototype.number = function() {
        return this.data.number;
    };

    Build.prototype.success = function() {
        return this.data.result == "SUCCESS";
    };

    Build.prototype.tests = function() {
        var actions = data.actions;

        for ( var i=  0; i < actions.length; i++ ) {
            if ( "testReport" == actions[i].urlName) {
                return actions[i];
            }
        }
        // can't find any tests, just say there was one test, and it failed if the build failed.
        return {
            failCount: this.success() ? 1 : 0,
            skipCount : 0,
            totalCount : 1
        }
    };

    function Job(name, uri) {
        this.name = name;
        this.uri = uri;
        this.builds = [];

        console.log(name);
    }

    Job.prototype.jobname = function() {
        return this.name;
    };

    Job.prototype.refresh = function() {
        var job = this;
        hudsonapi(this.uri, function(data) {
            job.refreshResult(data);
        })
    };

    function jobIsRunning(j) {
        return j.color.indexOf("anime") != -1;
    }

    Job.prototype.highestBuildNumber = function() {
        if ( this.builds.length == 0 ) {
            return -1;
        }
        return this.builds[-1].number();
    };

    Job.prototype.refreshResult = function(data) {
        var job = this;

        this.isbuilding = jobIsRunning(data);
        var lastCompleted = data.lastCompletedBuild;

        if ( ! lastCompleted ) {
            // no completed builds forget it.
            return;
        }

        if ( this.highestBuildNumber() < lastCompleted.number ) {
            var builds = data.builds.splice(0,10);
            $.each(builds, function(i,b) {
                if (b.number > job.highestBuildNumber() ) {
                    hudsonapi(b.url, function(data) {
                        job.updateBuildResult(data);
                    })
                }
            })
        }
    };

    Job.prototype.updateBuildResult = function(data) {
        this.builds.push(new Build(data));
        this.builds.sort(function (a, b) {
            return a.number() - b.number();
        });
        this.buildsUpdated();
    };

    Job.prototype.buildsUpdated = function() {
        console.log(this);
    };

    function View(uri) {
        this.uri = uri;
        this.jobs = [];
    }

    View.prototype.bootstrap = function() {
        var view = this;
        hudsonapi(this.uri, function(data) {
            view.refreshViewContents(data);
        },xhrerror);

        setTimeout(function() {
            view.bootstrap();
        }, 60000)
    };

    function isMatrixBuild(j) {
        return j.activeConfigurations;
    }

    function isDisabled(j) {
        return j.color.indexOf("disabled") != -1;
    }

    View.prototype.refreshViewContents = function(data) {
        var view = this;
        $.each(data.jobs, function(i,j) {
            hudsonapi(j.url, function(data) {
                view.refreshJob(data);
            })
        });
    };

    View.prototype.refreshJob = function(j) {
        var view = this;
        if ( isMatrixBuild(j)) {
            $.each(j.activeConfigurations, function(i,m) {
                hudsonapi(m.url, function(data) {
                    view.refreshJob(data);
                })
            } );
        }
        else {
            var name = j.name;
            if ( ! this.jobs[name] ) {
                if ( !isDisabled(j) ) {
                    var job = new Job(name, j.url);
                    this.jobAdded(job);
                    job.refresh();
                }
            }
        }
    };

    View.prototype.jobAdded = function(job) {
        this.jobs.push(job);
        this.jobs.sort(function(a,b){
            var an = a.jobname(), bn = b.jobname();
            return an > bn ? 1 : an < bn ? -1 : 0;
        })
    };

    var uri = getQuery("view");

    if ( ! uri ) {
        alert("use ?view=<view uri>");
    }
    else {
        var v = new View(uri);
        v.bootstrap();
    }
});