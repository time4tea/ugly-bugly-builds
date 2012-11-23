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

    Build.prototype.number = function () {
        return this.data.number;
    };

    Build.prototype.success = function () {
        return this.data.result == "SUCCESS";
    };

    Build.prototype.tests = function () {
        var actions = this.data.actions;

        for (var i = 0; i < actions.length; i++) {
            if ("testReport" == actions[i].urlName) {
                return actions[i];
            }
        }
        // can't find any tests, just say there was one test, and it failed if the build failed.
        return {
            failCount:this.success() ? 0 : 1,
            skipCount:0,
            totalCount:1
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

    Job.prototype.jobname = function () {
        return this.name;
    };

    Job.prototype.refresh = function () {
        var job = this;
        hudsonapi(this.uri, function (data) {
            job.refreshResult(data);
        })
    };

    function jobIsRunning(j) {
        return j.color.indexOf("anime") != -1;
    }

    Job.prototype.highestBuildNumber = function () {
        var count = this.builds.length;

        if (count == 0) {
            return -1;
        }
        return this.builds[count - 1].number();
    };

    Job.prototype.refreshResult = function (data) {
        var job = this;

        job.is_running = jobIsRunning(data);

        var lastCompleted = data.lastCompletedBuild;

        if (!lastCompleted) {
            // no completed builds forget it.
            return;
        }

        if (this.highestBuildNumber() < lastCompleted.number) {
            var builds = data.builds.slice(0, this.build_history);

            this.builds_available = builds.length;

            $.each(builds, function (i, b) {
                if (b.number > job.highestBuildNumber() && b.number <= lastCompleted.number) {
                    hudsonapi(b.url, function (data) {
                        job.updateBuildResult(data);
                    });
                }
            });
        }

        job.listener.job_updated(this);
    };

    Job.prototype.updateBuildResult = function (data) {
        this.builds.push(new Build(data));
        this.builds.sort(function (a, b) {
            return a.number() - b.number();
        });
        if (this.builds.length > this.build_history) {
            this.builds = this.builds.splice(-this.build_history);
        }
        this.listener.job_updated(this);
    };

    function View(uri, listener) {
        this.uri = uri;
        this.jobs = {};
        this.listener = listener;
    }

    View.prototype.bootstrap = function () {
        var view = this;
        hudsonapi(this.uri, function (data) {
            view.refreshViewContents(data);
        }, xhrerror);

        setTimeout(function () {
            view.bootstrap();
        }, 30000);
    };

    function isMatrixBuild(j) {
        return j.activeConfigurations;
    }

    function isDisabled(j) {
        return j.color.indexOf("disabled") != -1;
    }

    View.prototype.refreshViewContents = function (data) {
        var view = this;
        $.each(data.jobs, function (i, j) {
            hudsonapi(j.url, function (data) {
                view.refreshJob(data);
            })
        });
    };

    View.prototype.refreshJob = function (j) {
        var view = this;
        if (isMatrixBuild(j)) {
            $.each(j.activeConfigurations, function (i, m) {
                hudsonapi(m.url, function (data) {
                    view.refreshJob(data);
                })
            });
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
        this.graph_div = this.div.children(".graph")[0];
        this.plotted = -1;
    }

    JobPanel.prototype.job_updated = function (job) {
        var div = this.div;

        var most_recent_build = job.highestBuildNumber();

        if (most_recent_build > this.plotted) {
            if (job.builds.length == job.builds_available) {

                console.log("Redrawing " + job.name + " for build " + most_recent_build);

                div.removeClass();
                div.addClass("job");

                if (job.is_runnning) {
                    div.addClass("running");
                }
                else {
                    div.addClass("waiting");
                }

                if ( job.builds[job.builds.length - 1].success() ) {
                    div.addClass("passed");
                }
                else {
                    div.addClass("failed");
                }

                this.render_graph(job);

                this.plotted = most_recent_build;
            }
        }
    };

    JobPanel.prototype.render_graph = function (job) {
        var skipped = $.map(job.builds, function (e, i) {
            return { x:e.number(), y:e.tests().skipCount };
        });

        var pass = $.map(job.builds, function (e, i) {
            return { x:e.number(), y:e.tests().totalCount - ( e.tests().failCount + e.tests().skipCount ) };
        });

        var fail = $.map(job.builds, function (e, i) {
            return { x:e.number(), y:e.tests().failCount};
        });

        var div = $(this.graph_div);

        div.children("svg").remove();

        var graph = new Rickshaw.Graph({
            element:this.graph_div,
            renderer:'area',
            stroke:true,
            series:[
                { data:pass, color:'lightgreen' },
                { data:fail, color:'pink' }
            ]
        });

        graph.render();

        var yAxis = new Rickshaw.Graph.Axis.Y({
            graph:graph,
            tickFormat:Rickshaw.Fixtures.Number.formatKMBT
        });

        yAxis.render();

        var xAxis = new Rickshaw.Graph.Axis.X({
            graph:graph
        });

        xAxis.render();
    };

    function JobRender(container) {
        this.panels = {};
        this.container = container;
        this.count = 0;
    }

    JobRender.prototype.found_new_job = function (job) {
        console.log("********* New job " + job.name);
        var panel = new JobPanel(job);

        this.panels[job.name] = panel;
        this.container.append(panel.div);

        this.count++;

        this.resize_panels();
    };

    function fit_rects_into_area(nrects, ratio, height, width) {

        var best_area = -1;
        var best_alternatives = [
            { width:width, height:height }
        ];

        /*
         (1..nrect).each do |nhigh|
         nwide = ((nrect + nhigh - 1) / nhigh).truncate
         maxh, maxw = (screenh / nhigh).truncate, (screenw / nwide).truncate
         relh, relw = (maxw * ratio).truncate, (maxh / ratio).truncate
         acth, actw = min(maxh, relh), min(maxw, relw)
         area = acth * actw
         puts ([nhigh, nwide, maxh, maxw, relh, relw, acth, actw, area].join("\t"))
         end
         */

        for (var nhigh = 1; nhigh < nrects; nhigh++) {
            var nwide = Math.floor((nrects + nhigh - 1) / nhigh);
            var maxh = Math.floor(height / nhigh);
            var maxw = Math.floor(width / nwide);
            var relh = Math.floor(maxw * ratio);
            var relw = Math.floor(maxh / ratio);
            var acth = Math.min(maxh, relh);
            var actw = Math.min(maxw, relw);
            var area = acth * actw;

            console.log("high " + nhigh + ", wide " + nwide + ", acth " + acth + ", actw " + actw + ", area " + area);

            if (area > best_area) {
                best_alternatives = [
                    { width:actw, height:acth }
                ];
                best_area = area;
            }
            else if (area == best_area) {
                best_alternatives.push({ width:actw, height:acth });
            }
        }

        return best_alternatives[0];
    }

    JobRender.prototype.resize_panels = function () {

        var vpw = $(window).width();
        var vph = $(window).height();

        var count = this.count;

        var width = vpw - 30;
        var height = vph - ( this.container.offset().top + 30) ;

        var ratio = 1 / 1.618;

        var rect_size = fit_rects_into_area(count, ratio, height, width);

        var jobs = this.container.children(".job");
        var job_width = rect_size["width"];
        var job_height = rect_size["height"];

        jobs.width(job_width).height(job_height);

        jobs.children(".graph").each(function(index, div) {
            var element = $(div);

            var padding = element.padding();
            var margin = element.margin();
            var border = element.border();

            var width = job_width - ( (padding["left"] + padding["right"])  + (margin["left"] + margin["right"]) + ( border["left"] + border["right"]));
            var height = job_height - ( (padding["top"] + padding["bottom"])  + (margin["top"] + margin["bottom"] ) + ( border["top"] + border["bottom"]));

            element.height(height);
            element.width(width);
        });

        console.log("Count is " + count + " Available height, width " + height + " , " + width);
    };


    JobRender.prototype.job_updated = function (job) {
        this.panels[job.name].job_updated(job);
    };

    var uri = getQuery("view");

    if (!uri) {
        alert("use ?view=<view uri>");
    }
    else {
        var render = new JobRender($("#builds"));

        var v = new View(uri, render);
        v.bootstrap();
    }
});