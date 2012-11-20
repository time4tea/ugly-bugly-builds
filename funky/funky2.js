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
            failCount: this.success() ? 0 : 1,
            skipCount : 0,
            totalCount : 1
        }
    };

    function Job(name, uri, listener) {
        this.name = name;
        this.uri = uri;
        this.builds = [];
        this.is_running = false;
        this.listener = listener;
        this.build_history = 5;
        this.builds_available = -1;
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
        var count = this.builds.length;

        if ( count == 0 ) {
            return -1;
        }
        return this.builds[count - 1].number();
    };

    Job.prototype.refreshResult = function(data) {
        var job = this;

        job.is_running = jobIsRunning(data);

        var lastCompleted = data.lastCompletedBuild;

        if ( ! lastCompleted ) {
            // no completed builds forget it.
            return;
        }

        if ( this.highestBuildNumber() < lastCompleted.number ) {
            var builds = data.builds.slice(0,this.build_history);

            this.builds_available = builds.length;

            $.each(builds, function(i,b) {
                if (b.number > job.highestBuildNumber() && b.number <= lastCompleted.number) {
                    hudsonapi(b.url, function(data) {
                        job.updateBuildResult(data);
                    });
                }
            });
        }

        job.listener.job_updated(this);
    };

    Job.prototype.updateBuildResult = function(data) {
        this.builds.push(new Build(data));
        this.builds.sort(function (a, b) {
            return a.number() - b.number();
        });
        if ( this.builds.length > this.build_history ) {
            this.builds = this.builds.splice(- this.build_history);
        }
        this.listener.job_updated(this);
    };

    function View(uri, listener) {
        this.uri = uri;
        this.jobs = {};
        this.listener = listener;
    }

    View.prototype.bootstrap = function() {
        var view = this;
        hudsonapi(this.uri, function(data) {
            view.refreshViewContents(data);
        },xhrerror);

        setTimeout(function() {
            view.bootstrap();
        }, 30000);
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
            if (this.jobs[name]) {
                this.jobs[name].refresh();
            } else if (!isDisabled(j)) {
                var job = new Job(name, j.url, this.listener);
                this.jobs[name] = job;
                this.listener.found_new_job(job);
                job.refresh();
            }
        }
    };

    function JobPanel(job) {
        this.div = ich.testgraph({ name:job.name });
        this.plotted = -1;
    }

    JobPanel.prototype.job_updated = function(job) {
        var div = this.div;

        var most_recent_build = job.highestBuildNumber();

        if ( most_recent_build > this.plotted ) {
            if (job.builds.length == job.builds_available ) {

                console.log("Redrawing " + job.name + " for build " + most_recent_build );

                div.removeClass();
                div.addClass("graph");

                if (job.is_runnning) {
                    div.addClass("running");
                }
                else {
                    div.addClass("waiting");
                }

                this.render_graph(job);

                this.plotted = most_recent_build;
            }
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

    function JobRender(container) {
        this.panels = {};
        this.container = container;
        this.count = 0;
    }

    JobRender.prototype.found_new_job = function(job) {
        console.log("********* New job " + job.name);
        var panel = new JobPanel(job);

        this.panels[job.name] = panel;
        this.container.append(panel.div);

        this.count++;

        this.resize_panels();
    };

    JobRender.prototype.resize_panels = function() {

        var vpw = $(window).width();
        var vph = $(window).height();

        this.container.width(vpw - 30);
        this.container.height(vph - ( this.container.offset().top + 30 ) );

        // Element Height = Viewport height - element.offset.top - desired bottom margin

        var count = this.count;

        var height = this.container.height() - 50;
        var width = this.container.width() - 80;

        var hd, vd;

        if ( count <= 3 ) {
            hd = 1; vd = count;
        }
        else {
            hd = Math.ceil(Math.sqrt(count));
            vd = Math.floor( count / hd );
        }

        var panel_height = height / vd;
        var panel_width = width / hd;

        this.container.children(".graph").width(panel_width).height(panel_height);

        console.log("Count is " + count + " Available height, width " + height + " , " + width);

    };


    JobRender.prototype.job_updated = function(job) {
        this.panels[job.name].job_updated(job);
    };

    var uri = getQuery("view");

    if ( ! uri ) {
        alert("use ?view=<view uri>");
    }
    else {
        var render = new JobRender($("#graphs"));

        var v = new View(uri, render);
        v.bootstrap();
    }
});