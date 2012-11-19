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
        var actions = this.data.actions;

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

    function Job(name, uri, listener) {
        this.name = name;
        this.uri = uri;
        this.builds = [];
        this.listener = listener;
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

        this.is_running = jobIsRunning(data);

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

        job.listener.job_updated(this);
    };

    Job.prototype.updateBuildResult = function(data) {
        this.builds.push(new Build(data));
        this.builds.sort(function (a, b) {
            return a.number() - b.number();
        });
        if ( this.builds.length > 10 ) {
            this.builds = this.builds.splice(-10);
        }
        this.listener.job_updated(this);
    };

    function View(uri, listener) {
        this.uri = uri;
        this.jobs = [];
        this.listener = listener;
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
                    var job = new Job(name, j.url, this.listener);
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
        });
        this.listener.found_new_job(job);
    };

    function JobPanel(job) {
        this.div = ich.testgraph({ name:job.name });
        $("#graphs").append(this.div);
    }

    JobPanel.prototype.job_updated = function(job) {
        console.log(job.name + " updated " );
        console.log(this);

        var div = this.div;

        if ( job.builds.length == 10 ) {

            div.removeClass();
            div.addClass("graph");

            if (job.is_runnning) {
                div.addClass("running");
            }
            else {
                div.addClass("waiting");
            }

            this.render_graph(job);
        }
    };

    JobPanel.prototype.render_graph = function(job) {
        var skipped = $.map(job.builds, function(e,i) {
            return { x:e.number(), y:e.tests().skipCount };
        });

        var pass = $.map(job.builds, function(e,i) {
            return { x:e.number(), y:e.tests().totalCount - ( e.tests().failCount + e.tests().skipCount ) };
        });

        var fail = $.map(job.builds, function(e,i) {
            return { x :e.number(), y:e.tests().failCount};
        });

        $(this.div).children("svg").remove();

        var graph = new Rickshaw.Graph({
            element: this.div[0],
            renderer:'area',
            stroke:true,
            series:[
                { data:pass, color:'lightgreen' },
                { data:fail, color:'pink' }
            ]
        });

        graph.render();

        var yAxis = new Rickshaw.Graph.Axis.Y( {
            graph: graph,
            tickFormat: Rickshaw.Fixtures.Number.formatKMBT
        } );

        yAxis.render();

        var xAxis = new Rickshaw.Graph.Axis.X( {
            graph: graph
        } );

        xAxis.render();
    };

    function JobRender() {
        this.panels = {};
    }

    JobRender.prototype.found_new_job = function(job) {
        this.panels[job.name] = new JobPanel(job);
    };

    JobRender.prototype.job_updated = function(job) {
        this.panels[job.name].job_updated(job);
    };

    var uri = getQuery("view");

    if ( ! uri ) {
        alert("use ?view=<view uri>");
    }
    else {
        var render = new JobRender();

        var v = new View(uri, render);
        v.bootstrap();
    }
});