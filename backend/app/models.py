from tortoise import fields, models


class Project(models.Model):
    id = fields.IntField(pk=True)
    title = fields.CharField(max_length=255)
    description = fields.TextField()
    url = fields.CharField(max_length=500, null=True)
    created_at = fields.DatetimeField(auto_now_add=True)

    class Meta:
        table = "projects"

    def __str__(self):
        return self.title


class Score(models.Model):
    """One leaderboard entry — written when a run ends with score > 0."""

    id = fields.IntField(pk=True)
    name = fields.CharField(max_length=20)
    # Conference lead-capture fields. Optional at the schema level so a future
    # quick-play mode could write rows without PII.
    email = fields.CharField(max_length=120, default="")
    phone = fields.CharField(max_length=40, default="")
    score = fields.IntField()
    floors = fields.IntField(default=0)
    perfects = fields.IntField(default=0)
    max_combo = fields.IntField(default=0)
    tier = fields.IntField(default=0)
    foundation = fields.CharField(max_length=20, default="standard")
    created_at = fields.DatetimeField(auto_now_add=True)

    class Meta:
        table = "scores"
        ordering = ["-score"]

    def __str__(self):
        return f"{self.name}: {self.score}"
